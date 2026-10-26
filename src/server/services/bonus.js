import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { assertCan } from "@/server/auth/permissions";
import { dateOnly, istanbulToday, toIsoDate } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { bonusAwardSchema, bonusCriterionSchema, parseInput } from "@/server/validation/schemas";

const MONTHS = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export function bonusMonthLabel(month) {
  const [year, raw] = month.split("-");
  return `${MONTHS[Number(raw)] ?? month} ${year}`;
}

function money(value) {
  return new Prisma.Decimal(value).toFixed(2);
}

export async function getBonusPage(actor, monthInput) {
  assertCan(actor, "bonus:read");
  const month = monthInput && /^\d{4}-\d{2}$/.test(monthInput) ? monthInput : istanbulToday().slice(0, 7);
  const monthDate = dateOnly(`${month}-01`);
  return withDatabase(async (db) => {
    const [criteria, awards, people] = await Promise.all([
      db.bonusCriterion.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      db.bonusAward.findMany({
        where: { month: monthDate },
        include: {
          criterion: { select: { id: true, name: true } },
          recipients: { include: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } },
        },
        orderBy: [{ title: "asc" }],
      }),
      db.user.findMany({
        where: { active: true, mealOnly: false, NOT: { role: "ADMIN", approver: false } },
        select: { id: true, name: true, role: true, approver: true },
        orderBy: { name: "asc" },
      }),
    ]);
    const totals = new Map();
    for (const person of people) totals.set(person.id, new Prisma.Decimal(0));
    let company = new Prisma.Decimal(0);
    for (const award of awards) {
      for (const recipient of award.recipients) {
        company = company.plus(award.amount);
        totals.set(recipient.userId, (totals.get(recipient.userId) ?? new Prisma.Decimal(0)).plus(award.amount));
      }
    }
    return {
      month,
      monthLabel: bonusMonthLabel(month),
      companyTotal: company.toFixed(2),
      criteria: criteria.map((item) => ({
        id: item.id,
        name: item.name,
        defaultAmount: money(item.defaultAmount),
        active: item.active,
      })),
      people: people.map((person) => ({
        id: person.id,
        name: person.name,
        team: !(person.role === "ADMIN" && person.approver === false),
        total: (totals.get(person.id) ?? new Prisma.Decimal(0)).toFixed(2),
      })),
      awards: awards.map((award) => ({
        id: award.id,
        criterionId: award.criterion.id,
        criterionName: award.criterion.name,
        title: award.title,
        amount: money(award.amount),
        paid: award.paid,
        days: award.days,
        note: award.note,
        month: toIsoDate(award.month).slice(0, 7),
        recipientIds: award.recipients.map((recipient) => recipient.userId),
        recipientNames: award.recipients.map((recipient) => recipient.user.name),
      })),
    };
  });
}

export async function saveBonusCriterion(actor, input) {
  assertCan(actor, "bonus:write");
  const data = parseInput(bonusCriterionSchema, input);
  const amount = new Prisma.Decimal(data.defaultAmount);
  if (amount.lessThanOrEqualTo(0)) {
    throw new AppError("Ücret sıfırdan büyük olmalı.", "VALIDATION", 400);
  }
  return withDatabase(async (db) => {
    const nameTaken = await db.bonusCriterion.findFirst({
      where: { name: data.name, ...(data.id ? { NOT: { id: data.id } } : {}) },
      select: { id: true },
    });
    if (nameTaken) {
      throw new AppError("Bu kriter zaten var.", "CONFLICT", 409);
    }
    if (data.id) {
      const current = await db.bonusCriterion.findUnique({ where: { id: data.id }, select: { id: true } });
      if (!current) throw new AppError("Kriter bulunamadı.", "NOT_FOUND", 404);
      return db.bonusCriterion.update({
        where: { id: data.id },
        data: { name: data.name, defaultAmount: amount },
      });
    }
    const last = await db.bonusCriterion.aggregate({ _max: { sortOrder: true } });
    return db.bonusCriterion.create({
      data: { name: data.name, defaultAmount: amount, sortOrder: (last._max.sortOrder ?? 0) + 1 },
    });
  });
}

export async function setBonusCriterionActive(actor, id, active) {
  assertCan(actor, "bonus:write");
  return withDatabase(async (db) => {
    const current = await db.bonusCriterion.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new AppError("Kriter bulunamadı.", "NOT_FOUND", 404);
    return db.bonusCriterion.update({ where: { id }, data: { active } });
  });
}

export async function saveBonusAward(actor, input) {
  assertCan(actor, "bonus:write");
  const data = parseInput(bonusAwardSchema, input);
  const amount = new Prisma.Decimal(data.amount);
  if (amount.lessThanOrEqualTo(0)) {
    throw new AppError("Ücret sıfırdan büyük olmalı.", "VALIDATION", 400);
  }
  const userIds = [...new Set(data.userIds)];
  return withDatabase(async (db) => {
    const criterion = await db.bonusCriterion.findUnique({ where: { id: data.criterionId }, select: { id: true, active: true } });
    if (!criterion || (!criterion.active && !data.id)) {
      throw new AppError("Kriter bulunamadı.", "NOT_FOUND", 404);
    }
    const people = await db.user.findMany({
      where: { id: { in: userIds }, active: true, mealOnly: false, NOT: { role: "ADMIN", approver: false } },
      select: { id: true },
    });
    if (people.length !== userIds.length) {
      throw new AppError("Seçilen kişilerden biri prim listesinde değil.", "VALIDATION", 400);
    }
    const payload = {
      criterionId: data.criterionId,
      title: data.title,
      month: dateOnly(`${data.month}-01`),
      amount,
      paid: data.paid,
      days: data.days ?? null,
      note: data.note ?? null,
    };
    if (data.id) {
      const current = await db.bonusAward.findUnique({ where: { id: data.id }, select: { id: true } });
      if (!current) throw new AppError("Prim kaydı bulunamadı.", "NOT_FOUND", 404);
      await db.bonusRecipient.deleteMany({ where: { awardId: data.id } });
      return db.bonusAward.update({
        where: { id: data.id },
        data: { ...payload, recipients: { create: userIds.map((userId) => ({ userId })) } },
      });
    }
    return db.bonusAward.create({
      data: { ...payload, recipients: { create: userIds.map((userId) => ({ userId })) } },
    });
  });
}

export async function setBonusAwardPaid(actor, id, paid) {
  assertCan(actor, "bonus:write");
  return withDatabase(async (db) => {
    const current = await db.bonusAward.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new AppError("Prim kaydı bulunamadı.", "NOT_FOUND", 404);
    return db.bonusAward.update({ where: { id }, data: { paid } });
  });
}

export async function deleteBonusAward(actor, id) {
  assertCan(actor, "bonus:write");
  return withDatabase(async (db) => {
    const current = await db.bonusAward.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new AppError("Prim kaydı bulunamadı.", "NOT_FOUND", 404);
    await db.bonusAward.delete({ where: { id } });
  });
}
