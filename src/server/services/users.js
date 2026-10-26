import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { assertCan } from "@/server/auth/permissions";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { dateOnly } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { changeOwnPasswordSchema, createUserSchema, parseInput, updateUserSchema } from "@/server/validation/schemas";

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  mealOnly: true,
  approver: true,
  active: true,
  startedOn: true,
  createdAt: true,
} ;

function startedOnValue(value) {
  if (value === undefined) return undefined;
  return value ? dateOnly(value) : null;
}

export async function listUsers(actor) {
  assertCan(actor, "user:read:all");
  return withDatabase((db) =>
    db.user.findMany({
      select: publicUserSelect,
      orderBy: { name: "asc" },
    }),
  );
}

export async function deleteUser(actor, userId) {
  assertCan(actor, "user:update");
  if (actor.id === userId) {
    throw new AppError("Kendi hesabınızı silemezsiniz.", "FORBIDDEN", 403);
  }

  return withDatabase(async (db) => {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, active: true, approver: true },
    });
    if (!user) {
      throw new AppError("Kullanıcı bulunamadı.", "NOT_FOUND", 404);
    }
    if (user.role === "ADMIN" && user.active && user.approver) {
      const otherActiveAdmins = await db.user.count({
        where: { role: "ADMIN", active: true, approver: true, id: { not: userId } },
      });
      if (otherActiveAdmins === 0) {
        throw new AppError("Son yönetici silinemez.", "CONFLICT", 409);
      }
    }
    try {
      await db.user.delete({ where: { id: userId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new AppError("Bu hesabın izin, harcama veya sipariş kaydı var. Silinemez.", "CONFLICT", 409);
      }
      throw error;
    }
  });
}

export async function setUserActive(actor, userId, active) {
  assertCan(actor, "user:update");
  if (actor.id === userId && !active) {
    throw new AppError("Kendi hesabınızı kapatamazsınız.", "FORBIDDEN", 403);
  }

  return withDatabase(async (db) => {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, active: true, approver: true },
    });
    if (!user) {
      throw new AppError("Kullanıcı bulunamadı.", "NOT_FOUND", 404);
    }

    if (!active && user.role === "ADMIN" && user.approver) {
      const otherActiveAdmins = await db.user.count({
        where: { role: "ADMIN", active: true, approver: true, id: { not: userId } },
      });
      if (otherActiveAdmins === 0) {
        throw new AppError("Son yönetici kapatılamaz.", "CONFLICT", 409);
      }
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: { active },
      select: publicUserSelect,
    });

    if (!active) {
      await db.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return updated;
  });
}

export async function changeOwnPassword(actor, input, currentTokenHash) {
  assertCan(actor, "user:read:self");
  const data = parseInput(changeOwnPasswordSchema, input);
  const passwordHash = await hashPassword(data.newPassword);

  await withDatabase(async (db) => {
    const user = await db.user.findUnique({
      where: { id: actor.id },
      select: { id: true, active: true, passwordHash: true },
    });
    if (!user?.active) {
      throw new AppError("Bu işlem için yetkiniz yok.", "FORBIDDEN", 403);
    }
    const currentMatches = await verifyPassword(data.currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new AppError("Mevcut şifre hatalı.", "VALIDATION", 400);
    }
    const same = await verifyPassword(data.newPassword, user.passwordHash);
    if (same) {
      throw new AppError("Yeni şifre eskisiyle aynı olamaz.", "VALIDATION", 400);
    }
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    if (currentTokenHash) {
      await db.session.updateMany({
        where: { userId: user.id, revokedAt: null, tokenHash: { not: currentTokenHash } },
        data: { revokedAt: new Date() },
      });
    }
  });
}

export async function updateUser(actor, input) {
  assertCan(actor, "user:update");
  const data = parseInput(updateUserSchema, input);
  const passwordHash = data.password ? await hashPassword(data.password) : null;

  return withDatabase(async (db) => {
    const user = await db.user.findUnique({
      where: { id: data.userId },
      select: { id: true, role: true, approver: true },
    });
    if (!user) {
      throw new AppError("Kullanıcı bulunamadı.", "NOT_FOUND", 404);
    }
    if (user.role === "ADMIN" && user.approver && data.role !== "ADMIN") {
      const otherActiveAdmins = await db.user.count({
        where: { role: "ADMIN", active: true, approver: true, id: { not: user.id } },
      });
      if (otherActiveAdmins === 0) {
        throw new AppError("Son yönetici personel yapılamaz.", "CONFLICT", 409);
      }
    }
    if (data.email) {
      const taken = await db.user.findFirst({
        where: { email: data.email, id: { not: user.id } },
        select: { id: true },
      });
      if (taken) {
        throw new AppError("Bu e-posta zaten kullanılıyor.", "CONFLICT", 409);
      }
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        name: data.name,
        role: data.role,
        mealOnly: data.role === "EMPLOYEE" && data.mealOnly,
        ...(data.email ? { email: data.email } : {}),
        ...(passwordHash ? { passwordHash } : {}),
        ...("startedOn" in data ? { startedOn: startedOnValue(data.startedOn) } : {}),
      },
      select: publicUserSelect,
    });
    if (passwordHash) {
      await db.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return updated;
  });
}

export async function createUser(actor, input) {
  assertCan(actor, "user:create");
  const data = parseInput(createUserSchema, input);
  const passwordHash = await hashPassword(data.password);

  return withDatabase((db) =>
    db.user.create({
      data: {
        email: data.email,
        name: data.name,
        role: data.role,
        mealOnly: data.role === "EMPLOYEE" && data.mealOnly,
        startedOn: startedOnValue(data.startedOn) ?? null,
        passwordHash,
      },
      select: publicUserSelect,
    }),
  );
}
