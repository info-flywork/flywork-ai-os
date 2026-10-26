import "server-only";
import { assertCan, type Actor } from "@/server/auth/permissions";
import { dateOnly, toIsoDate } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { paidSubscriptionSchema, parseInput } from "@/server/validation/schemas";

const CYCLE_LABEL = {
  MONTHLY: "Aylık",
  YEARLY: "Yıllık",
  USAGE: "Kullanıma bağlı",
} as const;

export type PaidSubscriptionRow = {
  id: string;
  name: string;
  cycle: string;
  cycleCode: "MONTHLY" | "YEARLY" | "USAGE";
  amount: string | null;
  currency: string | null;
  startedOn: string | null;
  lastPaidOn: string | null;
};

export async function listPaidSubscriptions(actor: Actor): Promise<PaidSubscriptionRow[]> {
  assertCan(actor, "subscription:read");
  return withDatabase(async (db) => {
    const rows = await db.paidSubscription.findMany({ orderBy: { sortOrder: "asc" } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      cycle: CYCLE_LABEL[row.cycle],
      cycleCode: row.cycle,
      amount: row.amount?.toFixed(2) ?? null,
      currency: row.currency,
      startedOn: row.startedOn ? toIsoDate(row.startedOn) : null,
      lastPaidOn: row.lastPaidOn ? toIsoDate(row.lastPaidOn) : null,
    }));
  });
}

export async function savePaidSubscription(actor: Actor, input: unknown) {
  assertCan(actor, "subscription:write");
  const data = parseInput(paidSubscriptionSchema, input);
  if (data.amount && !data.currency) {
    throw new AppError("Para birimi seçin.", "VALIDATION", 400);
  }
  const payload = {
    name: data.name,
    cycle: data.cycle,
    amount: data.amount ?? null,
    currency: data.amount ? data.currency : null,
    startedOn: data.startedOn ? dateOnly(data.startedOn) : null,
    lastPaidOn: data.lastPaidOn ? dateOnly(data.lastPaidOn) : null,
  };
  return withDatabase(async (db) => {
    const nameTaken = await db.paidSubscription.findFirst({
      where: { name: data.name, ...(data.id ? { NOT: { id: data.id } } : {}) },
      select: { id: true },
    });
    if (nameTaken) {
      throw new AppError("Bu abonelik zaten var.", "CONFLICT", 409);
    }
    if (data.id) {
      const current = await db.paidSubscription.findUnique({ where: { id: data.id }, select: { id: true } });
      if (!current) throw new AppError("Abonelik bulunamadı.", "NOT_FOUND", 404);
      return db.paidSubscription.update({ where: { id: data.id }, data: payload });
    }
    const last = await db.paidSubscription.aggregate({ _max: { sortOrder: true } });
    return db.paidSubscription.create({
      data: { ...payload, sortOrder: (last._max.sortOrder ?? 0) + 1 },
    });
  });
}

export async function deletePaidSubscription(actor: Actor, id: string) {
  assertCan(actor, "subscription:write");
  return withDatabase(async (db) => {
    const current = await db.paidSubscription.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new AppError("Abonelik bulunamadı.", "NOT_FOUND", 404);
    await db.paidSubscription.delete({ where: { id } });
  });
}
