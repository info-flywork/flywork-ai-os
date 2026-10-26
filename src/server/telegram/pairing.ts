import "server-only";
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { assertCan, type Actor } from "@/server/auth/permissions";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;
const CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_LINK_TTL_MS = 30 * 60 * 1000;

export function hashPairingCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function pairingCode(): string {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

function normalizeCode(code: string): string | null {
  const clean = code.trim().toUpperCase().replace(/\s+/g, "");
  if (clean.length !== CODE_LENGTH || [...clean].some((char) => !ALPHABET.includes(char))) {
    return null;
  }
  return clean;
}

export async function createTelegramPairing(actor: Actor, now = new Date()) {
  assertCan(actor, "telegram:link");
  const code = pairingCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await withDatabase((db) =>
    db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: actor.id },
        select: { id: true, role: true, active: true },
      });
      if (!user?.active || (user.role !== "ADMIN" && user.role !== "EMPLOYEE")) {
        throw new AppError("Bu işlem için yetkiniz yok.", "FORBIDDEN", 403);
      }
      await tx.telegramPairingCode.deleteMany({ where: { userId: actor.id, usedAt: null } });
      await tx.telegramPairingCode.create({
        data: { userId: actor.id, codeHash: hashPairingCode(code), expiresAt },
      });
    }),
  );
  return { code, expiresAt };
}

export async function consumeTelegramPairing(input: {
  code: string;
  telegramUserId: string;
  chatId: string;
  now?: Date;
}) {
  const code = normalizeCode(input.code);
  if (!code || !/^\d{4,20}$/.test(input.telegramUserId) || input.telegramUserId !== input.chatId) {
    throw new AppError("Eşleştirme kodu geçersiz.", "VALIDATION", 400);
  }
  const now = input.now ?? new Date();
  const codeHash = hashPairingCode(code);

  return withDatabase((db) =>
    db.$transaction(async (tx) => {
      const row = await tx.telegramPairingCode.findUnique({
        where: { codeHash },
        include: { user: { select: { id: true, role: true, active: true } } },
      });
      if (!row || row.usedAt || row.expiresAt <= now || !row.user.active || (row.user.role !== "ADMIN" && row.user.role !== "EMPLOYEE")) {
        throw new AppError("Eşleştirme kodu geçersiz.", "VALIDATION", 400);
      }
      const taken = await tx.telegramLink.findUnique({ where: { telegramUserId: input.telegramUserId } });
      if (taken && taken.userId !== row.userId) {
        throw new AppError("Bu Telegram hesabı kullanılamıyor.", "CONFLICT", 409);
      }
      const marked = await tx.telegramPairingCode.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (marked.count !== 1) {
        throw new AppError("Eşleştirme kodu geçersiz.", "VALIDATION", 400);
      }
      await tx.telegramLink.upsert({
        where: { userId: row.userId },
        create: {
          userId: row.userId,
          telegramUserId: input.telegramUserId,
          chatId: input.chatId,
        },
        update: {
          telegramUserId: input.telegramUserId,
          chatId: input.chatId,
          revokedAt: null,
          linkedAt: now,
        },
      });
      return { userId: row.userId };
    }),
  );
}

function privateChat(telegramUserId: string, chatId: string) {
  return /^\d{4,20}$/.test(telegramUserId) && telegramUserId === chatId;
}

async function openLink(telegramUserId: string) {
  return withDatabase((db) =>
    db.telegramLink.findUnique({
      where: { telegramUserId },
      select: { userId: true, revokedAt: true },
    }),
  );
}

export async function beginTelegramEmailLink(input: {
  telegramUserId: string;
  chatId: string;
  now?: Date;
}) {
  if (!privateChat(input.telegramUserId, input.chatId)) {
    return { kind: "invalid" as const };
  }
  const now = input.now ?? new Date();
  const current = await openLink(input.telegramUserId);
  if (current && !current.revokedAt) {
    return { kind: "already" as const };
  }
  const expiresAt = new Date(now.getTime() + EMAIL_LINK_TTL_MS);
  await withDatabase((db) =>
    db.$transaction(async (tx) => {
      await tx.telegramLinkRequest.updateMany({
        where: { telegramUserId: input.telegramUserId, status: { in: ["AWAITING_EMAIL", "PENDING"] } },
        data: { status: "REJECTED", decidedAt: now },
      });
      await tx.telegramLinkRequest.create({
        data: {
          telegramUserId: input.telegramUserId,
          chatId: input.chatId,
          status: "AWAITING_EMAIL",
          expiresAt,
        },
      });
    }),
  );
  return { kind: "ask" as const };
}

export async function submitTelegramEmail(input: {
  telegramUserId: string;
  chatId: string;
  email: string;
  now?: Date;
}) {
  if (!privateChat(input.telegramUserId, input.chatId)) {
    return { kind: "idle" as const };
  }
  const now = input.now ?? new Date();
  const email = z.email().safeParse(input.email.trim().toLowerCase());
  return withDatabase(async (db) => {
    const waiting = await db.telegramLinkRequest.findFirst({
      where: {
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
        status: "AWAITING_EMAIL",
      },
      orderBy: { createdAt: "desc" },
    });
    if (!waiting) {
      return { kind: "idle" as const };
    }
    if (waiting.expiresAt <= now) {
      return { kind: "expired" as const };
    }
    if (!email.success) {
      return { kind: "invalid" as const };
    }
    const user = await db.user.findUnique({
      where: { email: email.data },
      select: { id: true, name: true, active: true, role: true },
    });
    if (!user?.active || (user.role !== "ADMIN" && user.role !== "EMPLOYEE")) {
      return { kind: "unknown" as const };
    }
    const account = await db.telegramLink.findUnique({
      where: { userId: user.id },
      select: { telegramUserId: true, revokedAt: true },
    });
    if (account && !account.revokedAt && account.telegramUserId !== input.telegramUserId) {
      return { kind: "account-taken" as const };
    }
    const telegram = await db.telegramLink.findUnique({
      where: { telegramUserId: input.telegramUserId },
      select: { userId: true, revokedAt: true },
    });
    if (telegram && !telegram.revokedAt && telegram.userId !== user.id) {
      return { kind: "telegram-taken" as const };
    }
    const admins = await db.telegramLink.findMany({
      where: { revokedAt: null, user: { role: "ADMIN", active: true, approver: true } },
      select: { chatId: true },
    });
    if (admins.length === 0) {
      return { kind: "no-admin" as const };
    }
    await db.telegramLinkRequest.update({
      where: { id: waiting.id },
      data: { status: "PENDING", userId: user.id, expiresAt: new Date(now.getTime() + EMAIL_LINK_TTL_MS) },
    });
    return { kind: "pending" as const, requestId: waiting.id, name: user.name, adminChatIds: admins.map((admin) => admin.chatId) };
  });
}

export async function decideTelegramEmailLink(input: {
  actor: Actor;
  requestId: string;
  decision: "APPROVED" | "REJECTED";
  now?: Date;
}) {
  if (input.actor.role !== "ADMIN" || input.actor.approver === false) {
    throw new AppError("Bu işlem için yetkiniz yok.", "FORBIDDEN", 403);
  }
  const now = input.now ?? new Date();
  return withDatabase((db) =>
    db.$transaction(async (tx) => {
      const request = await tx.telegramLinkRequest.findUnique({
        where: { id: input.requestId },
        include: { user: { select: { id: true, name: true, active: true, role: true } } },
      });
      if (!request?.user || (request.user.role !== "ADMIN" && request.user.role !== "EMPLOYEE") || !request.user.active) {
        return { outcome: "missing" as const };
      }
      if (request.status === "APPROVED") {
        return { outcome: "approved" as const, name: request.user.name, employeeChatId: request.chatId };
      }
      if (request.status === "REJECTED") {
        return { outcome: "rejected" as const, name: request.user.name, employeeChatId: request.chatId };
      }
      if (request.status !== "PENDING" || request.expiresAt <= now) {
        return { outcome: "expired" as const };
      }
      if (input.decision === "REJECTED") {
        await tx.telegramLinkRequest.update({
          where: { id: request.id },
          data: { status: "REJECTED", decidedAt: now },
        });
        return { outcome: "rejected" as const, name: request.user.name, employeeChatId: request.chatId };
      }
      const telegram = await tx.telegramLink.findUnique({
        where: { telegramUserId: request.telegramUserId },
        select: { userId: true, revokedAt: true },
      });
      if (telegram && !telegram.revokedAt && telegram.userId !== request.user.id) {
        return { outcome: "taken" as const };
      }
      const account = await tx.telegramLink.findUnique({
        where: { userId: request.user.id },
        select: { telegramUserId: true, revokedAt: true },
      });
      if (account && !account.revokedAt && account.telegramUserId !== request.telegramUserId) {
        return { outcome: "taken" as const };
      }
      await tx.telegramLink.upsert({
        where: { userId: request.user.id },
        create: {
          userId: request.user.id,
          telegramUserId: request.telegramUserId,
          chatId: request.chatId,
        },
        update: {
          telegramUserId: request.telegramUserId,
          chatId: request.chatId,
          revokedAt: null,
          linkedAt: now,
        },
      });
      await tx.telegramLinkRequest.update({
        where: { id: request.id },
        data: { status: "APPROVED", decidedAt: now },
      });
      return { outcome: "approved" as const, name: request.user.name, employeeChatId: request.chatId };
    }),
  );
}

export async function isTelegramLinked(userId: string) {
  const link = await withDatabase((db) =>
    db.telegramLink.findUnique({ where: { userId }, select: { revokedAt: true } }),
  );
  return Boolean(link && !link.revokedAt);
}

export async function revokeTelegramLink(actor: Actor, now = new Date()) {
  assertCan(actor, "telegram:link");
  await withDatabase((db) =>
    db.telegramLink.updateMany({
      where: { userId: actor.id, revokedAt: null },
      data: { revokedAt: now },
    }),
  );
}
