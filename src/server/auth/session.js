import "server-only";
import { io } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { openSessionToken, sealSessionToken } from "@/server/auth/cookieSeal";
import { verifyPassword } from "@/server/auth/password";

import { changeOwnPassword } from "@/server/services/users";
import { createSessionToken, hashSessionToken } from "@/server/auth/token";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { loginSchema, parseInput } from "@/server/validation/schemas";

const SESSION_COOKIE = "flywork_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USER_CACHE_MS = 60_000;
const userCache = new Map();
const DUMMY_PASSWORD_HASH =
  "scrypt$5px7oVC-ovQfA-k4h4e9_g$YDeumFaCrMAmROdaQpHNpZxRI8werQE_GjzaamaQGOgBSXB3fChfU6V8DXw-yBV_jJPKEAg8bGE8_MpvyOHVtQ";

function cookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" ,
    path: "/",
    expires: expiresAt,
  };
}

async function readRawToken() {
  const sealed = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sealed) {
    return null;
  }
  return openSessionToken(sealed);
}

export async function createSession(
  userId,
  access = {},
) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await withDatabase((db) =>
    db.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt,
      },
    }),
  );

  const sealed = await sealSessionToken(token, expiresAt);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sealed, cookieOptions(expiresAt));
  if (access.mealOnly) {
    jar.set("flywork_meal", "1", cookieOptions(expiresAt));
    jar.delete("flywork_staff");
  } else if (access.role === "EMPLOYEE") {
    jar.delete("flywork_meal");
    jar.set("flywork_staff", "1", cookieOptions(expiresAt));
  } else {
    jar.delete("flywork_meal");
    jar.delete("flywork_staff");
  }
}

export async function readCurrentUser() {
  await io();
  const token = await readRawToken();
  if (!token) {
    return null;
  }
  const cacheKey = hashSessionToken(token);
  const cached = userCache.get(cacheKey);
  if (cached && cached.until > Date.now()) {
    return cached.user;
  }

  const session = await withDatabase((db) =>
    db.session.findUnique({
      where: { tokenHash: cacheKey },
      include: {
        user: {
          select: { id: true, email: true, name: true, role: true, active: true, mealOnly: true, approver: true },
        },
      },
    }),
  );

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt.getTime() <= Date.now() ||
    !session.user.active
  ) {
    return null;
  }

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    mealOnly: session.user.mealOnly,
    approver: session.user.approver,
  };
  userCache.set(cacheKey, { user, until: Date.now() + USER_CACHE_MS });
  return user;
}

export async function requireUser() {
  const user = await readCurrentUser();
  if (!user) {
    redirect("/giris");
  }
  return user;
}

export async function loginWithPassword(input) {
  const credentials = parseInput(loginSchema, input);
  const user = await withDatabase((db) =>
    db.user.findUnique({ where: { email: credentials.email } }),
  );

  const passwordMatches = await verifyPassword(
    credentials.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !user.active || !passwordMatches) {
    throw new AppError("E-posta veya şifre hatalı.", "UNAUTHENTICATED", 401);
  }

  await createSession(user.id, { mealOnly: user.mealOnly, role: user.role });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mealOnly: user.mealOnly,
  };
}

export async function changeOwnPasswordFromSession(input) {
  const user = await requireUser();
  const token = await readRawToken();
  if (!token) {
    throw new AppError("Oturum bulunamadı.", "UNAUTHENTICATED", 401);
  }
  await changeOwnPassword(user, input, hashSessionToken(token));
}

export async function logout() {
  const token = await readRawToken();
  if (token) {
    const cacheKey = hashSessionToken(token);
    userCache.delete(cacheKey);
    await withDatabase((db) =>
      db.session.updateMany({
        where: { tokenHash: cacheKey, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete("flywork_meal");
  jar.delete("flywork_staff");
}
