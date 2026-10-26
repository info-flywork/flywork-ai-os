import "server-only";

import { assertCan } from "@/server/auth/permissions";
import { dateOnly, istanbulToday, toIsoDate } from "@/server/dates";
import { writeRenewalNotices } from "@/server/technology/notices";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  addCycle,
  daysUntil,
  groupCurrency,
  monthBounds,
  yearBounds,
} from "@/server/technology/schedule";

import {
  parseInput,
  renewalPaymentSchema,
  technologyFilterSchema,
  technologySchema,
  technologyStatusSchema,
} from "@/server/validation/schemas";

function blank(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sameMoney(left, right) {
  return Number(left.toString()).toFixed(2) === Number(right).toFixed(2);
}

function toWriteData(data) {
  return {
    name: data.name,
    vendor: data.vendor,
    kind: data.kind,
    description: blank(data.description),
    project: blank(data.project),
    ownerId: data.ownerId ?? null,
    status: data.status,
    active: data.status === "ACTIVE",
    websiteUrl: blank(data.websiteUrl),
    panelUrl: blank(data.panelUrl),
    amount: data.amount,
    currency: data.currency,
    billingCycle: data.billingCycle,
    customIntervalDays: data.billingCycle === "CUSTOM" ? (data.customIntervalDays ?? null) : null,
    renewsOn: dateOnly(data.renewsOn),
    lastPaidOn: data.lastPaidOn ? dateOnly(data.lastPaidOn) : null,
    paymentMethod: data.paymentMethod,
    cardLast4: data.paymentMethod === "CARD" ? blank(data.cardLast4) : null,
    autoRenew: data.status === "CANCELLED" ? false : data.autoRenew,
    domainName: blank(data.domainName),
    registrar: blank(data.registrar),
    domainExpiresOn: data.domainExpiresOn ? dateOnly(data.domainExpiresOn) : null,
    dnsProvider: blank(data.dnsProvider),
    sslIssuer: blank(data.sslIssuer),
    sslExpiresOn: data.sslExpiresOn ? dateOnly(data.sslExpiresOn) : null,
    note: blank(data.note),
  };
}





























async function assertOwner(ownerId) {
  if (!ownerId) {
    return;
  }
  const owner = await withDatabase((db) =>
    db.user.findUnique({ where: { id: ownerId }, select: { active: true } }),
  );
  if (!owner?.active) {
    throw new AppError("Sorumlu kişi bulunamadı.", "VALIDATION", 400);
  }
}

export async function syncTechnologyNotices(actor) {
  assertCan(actor, "subscription:write");
  const createdWindow = await withDatabase((db) => writeRenewalNotices(db));
  return { createdWindow };
}

export async function getTechnologyPage(actor, input) {
  assertCan(actor, "subscription:read");
  await syncTechnologyNotices(actor);
  const filters = parseInput(technologyFilterSchema, input);
  const month = filters.month ?? istanbulToday().slice(0, 7);
  const year = month.slice(0, 4);
  const today = istanbulToday();
  const where = {
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.query
      ? {
          OR: [
            { name: { contains: filters.query } },
            { vendor: { contains: filters.query } },
            { domainName: { contains: filters.query } },
            { project: { contains: filters.query } },
          ],
        }
      : {}),
  };
  const monthRange = monthBounds(month);
  const yearRange = yearBounds(year);

  return withDatabase(async (db) => {
    const [subscriptions, notices, people, monthPaid, yearPaid, monthDue, yearDue, linkable, activeDates] =
      await Promise.all([
        db.technologySubscription.findMany({
          where,
          include: {
            owner: { select: { id: true, name: true } },
            renewals: { orderBy: { paidOn: "desc" }, take: 5, include: { expense: { select: { id: true } } } },
          },
          orderBy: [{ status: "asc" }, { renewsOn: "asc" }],
        }),
        db.subscriptionNotice.findMany({
          include: { subscription: { select: { name: true } } },
          orderBy: [{ dueOn: "asc" }, { thresholdDays: "desc" }],
          take: 40,
        }),
        db.user.findMany({
          where: { active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        db.subscriptionRenewal.findMany({
          where: { paidOn: { gte: dateOnly(monthRange.start), lte: dateOnly(monthRange.end) } },
          select: { amount: true, currency: true },
        }),
        db.subscriptionRenewal.findMany({
          where: { paidOn: { gte: dateOnly(yearRange.start), lte: dateOnly(yearRange.end) } },
          select: { amount: true, currency: true },
        }),
        db.technologySubscription.findMany({
          where: {
            status: "ACTIVE",
            renewsOn: { gte: dateOnly(monthRange.start), lte: dateOnly(monthRange.end) },
          },
          select: { amount: true, currency: true },
        }),
        db.technologySubscription.findMany({
          where: {
            status: "ACTIVE",
            renewsOn: { gte: dateOnly(yearRange.start), lte: dateOnly(yearRange.end) },
          },
          select: { amount: true, currency: true },
        }),
        db.expense.findMany({
          where: {
            scope: "COMPANY",
            category: "SUBSCRIPTION",
            renewal: null,
            spentOn: { lte: dateOnly(today) },
          },
          select: { id: true, title: true, amount: true, currency: true, spentOn: true },
          orderBy: { spentOn: "desc" },
          take: 50,
        }),
        db.technologySubscription.findMany({
          where: { status: "ACTIVE" },
          select: {
            id: true,
            name: true,
            renewsOn: true,
            domainExpiresOn: true,
            sslExpiresOn: true,
          },
        }),
      ]);

    const calendar = new Map();
    const overdue = [];
    for (const subscription of activeDates) {
      const points = [
        { subject: "BILLING", dueOn: toIsoDate(subscription.renewsOn) },
      ];
      if (subscription.domainExpiresOn) {
        points.push({ subject: "DOMAIN", dueOn: toIsoDate(subscription.domainExpiresOn) });
      }
      if (subscription.sslExpiresOn) {
        points.push({ subject: "SSL", dueOn: toIsoDate(subscription.sslExpiresOn) });
      }
      for (const point of points) {
        const remaining = daysUntil(today, point.dueOn);
        if (remaining < 0) {
          overdue.push({
            id: subscription.id,
            name: subscription.name,
            subject: point.subject,
            dueOn: point.dueOn,
            days: remaining,
          });
        } else if (remaining <= 60) {
          const items = calendar.get(point.dueOn) ?? [];
          items.push({ id: subscription.id, name: subscription.name, subject: point.subject });
          calendar.set(point.dueOn, items);
        }
      }
    }

    return {
      month,
      year,
      filters,
      people,
      realizedMonth: groupCurrency(monthPaid.map(money)),
      realizedYear: groupCurrency(yearPaid.map(money)),
      plannedMonth: groupCurrency(monthDue.map(money)),
      plannedYear: groupCurrency(yearDue.map(money)),
      notices: notices.map((notice) => ({
        id: notice.id,
        name: notice.subscription.name,
        subject: notice.subject,
        dueOn: toIsoDate(notice.dueOn),
        thresholdDays: notice.thresholdDays,
      })),
      overdue,
      calendar: [...calendar.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, items]) => ({ date, items })),
      linkableExpenses: linkable.map((expense) => ({
        id: expense.id,
        title: expense.title,
        amount: expense.amount.toString(),
        currency: expense.currency,
        spentOn: toIsoDate(expense.spentOn),
      })),
      subscriptions: subscriptions.map((subscription) => ({
        id: subscription.id,
        name: subscription.name,
        vendor: subscription.vendor,
        kind: subscription.kind,
        description: subscription.description,
        project: subscription.project,
        ownerId: subscription.owner?.id ?? null,
        ownerName: subscription.owner?.name ?? null,
        status: subscription.status,
        websiteUrl: subscription.websiteUrl,
        panelUrl: subscription.panelUrl,
        amount: subscription.amount.toString(),
        currency: subscription.currency,
        billingCycle: subscription.billingCycle,
        customIntervalDays: subscription.customIntervalDays,
        renewsOn: toIsoDate(subscription.renewsOn),
        daysUntil: daysUntil(today, toIsoDate(subscription.renewsOn)),
        lastPaidOn: subscription.lastPaidOn ? toIsoDate(subscription.lastPaidOn) : null,
        paymentMethod: subscription.paymentMethod,
        cardLast4: subscription.cardLast4,
        autoRenew: subscription.autoRenew,
        domainName: subscription.domainName,
        registrar: subscription.registrar,
        domainExpiresOn: subscription.domainExpiresOn ? toIsoDate(subscription.domainExpiresOn) : null,
        dnsProvider: subscription.dnsProvider,
        sslIssuer: subscription.sslIssuer,
        sslExpiresOn: subscription.sslExpiresOn ? toIsoDate(subscription.sslExpiresOn) : null,
        note: subscription.note,
        renewals: subscription.renewals.map((renewal) => ({
          id: renewal.id,
          paidOn: toIsoDate(renewal.paidOn),
          periodEnd: toIsoDate(renewal.periodEnd),
          amount: renewal.amount.toString(),
          currency: renewal.currency,
          expenseId: renewal.expense?.id ?? null,
        })),
      })),
    };
  });
}

function money(row) {
  return { amount: row.amount.toString(), currency: row.currency };
}

export async function saveTechnology(actor, subscriptionId, input) {
  assertCan(actor, "subscription:write");
  const data = parseInput(technologySchema, input) ;
  if (data.lastPaidOn && data.lastPaidOn > istanbulToday()) {
    throw new AppError("Gelecek tarih gerçekleşmiş ödeme olarak kaydedilemez.", "VALIDATION", 400);
  }
  await assertOwner(data.ownerId);
  const { ownerId, ...fields } = toWriteData(data);
  const payload = subscriptionId && data.ownerId === undefined ? fields : { ...fields, ownerId };
  if (!subscriptionId) {
    const created = await withDatabase((db) => db.technologySubscription.create({ data: payload }));
    return { id: created.id };
  }
  const updated = await withDatabase((db) =>
    db.technologySubscription.updateMany({ where: { id: subscriptionId }, data: payload }),
  );
  if (updated.count !== 1) {
    throw new AppError("Hizmet bulunamadı.", "NOT_FOUND", 404);
  }
  return { id: subscriptionId };
}

export async function deleteTechnology(actor, subscriptionId) {
  assertCan(actor, "subscription:write");
  const deleted = await withDatabase((db) =>
    db.technologySubscription.deleteMany({ where: { id: subscriptionId } }),
  );
  if (deleted.count !== 1) {
    throw new AppError("Hizmet bulunamadı.", "NOT_FOUND", 404);
  }
}

export async function setTechnologyStatus(actor, input) {
  assertCan(actor, "subscription:write");
  const data = parseInput(technologyStatusSchema, input);
  const updated = await withDatabase((db) =>
    db.technologySubscription.updateMany({
      where: { id: data.subscriptionId },
      data: {
        status: data.status,
        active: data.status === "ACTIVE",
        ...(data.status === "CANCELLED" ? { autoRenew: false } : {}),
      },
    }),
  );
  if (updated.count !== 1) {
    throw new AppError("Hizmet bulunamadı.", "NOT_FOUND", 404);
  }
  return { id: data.subscriptionId, status: data.status };
}

export async function recordSubscriptionPayment(actor, input) {
  assertCan(actor, "subscription:write");
  const data = parseInput(renewalPaymentSchema, input);
  if (data.paidOn > istanbulToday()) {
    throw new AppError("Gelecek tarihli ödeme gider olarak kaydedilemez.", "VALIDATION", 400);
  }
  if (data.expenseId && data.createExpense) {
    throw new AppError("Ödeme ya mevcut gidere bağlanır ya da tek gider kaydı açar.", "VALIDATION", 400);
  }

  try {
    return await withDatabase((db) =>
      db.$transaction(async (tx) => {
        const subscription = await tx.technologySubscription.findUnique({
          where: { id: data.subscriptionId },
        });
        if (!subscription) {
          throw new AppError("Hizmet bulunamadı.", "NOT_FOUND", 404);
        }
        if (subscription.status === "CANCELLED") {
          throw new AppError("İptal edilen hizmete ödeme işlenmez.", "CONFLICT", 409);
        }
        if (toIsoDate(subscription.renewsOn) !== data.periodEnd) {
          throw new AppError("Dönem tarihi güncel değil. Sayfayı yenileyin.", "CONFLICT", 409);
        }

        let expenseId = data.expenseId ?? null;
        if (expenseId) {
          const expense = await tx.expense.findUnique({ where: { id: expenseId } });
          if (!expense || expense.scope !== "COMPANY" || expense.spentOn > dateOnly(istanbulToday())) {
            throw new AppError("Bağlanacak gider gerçekleşmiş bir Flywork gideri olmalı.", "VALIDATION", 400);
          }
          if (expense.currency !== data.currency || !sameMoney(expense.amount, data.amount)) {
            throw new AppError("Gider tutarı ve para birimi ödeme ile aynı olmalı.", "VALIDATION", 400);
          }
          const linked = await tx.subscriptionRenewal.findUnique({ where: { expenseId } });
          if (linked) {
            throw new AppError("Bu gider başka bir abonelik ödemesine bağlı.", "CONFLICT", 409);
          }
        } else if (data.createExpense) {
          const expense = await tx.expense.create({
            data: {
              userId: actor.id,
              scope: "COMPANY",
              category: "SUBSCRIPTION",
              title: subscription.name,
              vendor: subscription.vendor,
              amount: data.amount,
              currency: data.currency,
              paymentMethod: subscription.paymentMethod,
              accountLabel: subscription.cardLast4 ? `****${subscription.cardLast4}` : null,
              spentOn: dateOnly(data.paidOn),
              status: "PAID",
              reimbursement: "NOT_REQUIRED",
              source: "MANUAL",
              note: blank(data.note) ?? "Teknoloji abonelik ödemesi",
              reviewerId: actor.id,
              reviewedAt: new Date(),
            },
          });
          expenseId = expense.id;
        }

        await tx.subscriptionRenewal.create({
          data: {
            subscriptionId: subscription.id,
            paidOn: dateOnly(data.paidOn),
            periodEnd: dateOnly(data.periodEnd),
            amount: data.amount,
            currency: data.currency,
            expenseId,
            note: blank(data.note),
          },
        });
        const nextRenewal = addCycle(
          data.periodEnd,
          subscription.billingCycle,
          subscription.customIntervalDays ?? undefined,
        );
        await tx.technologySubscription.update({
          where: { id: subscription.id },
          data: {
            lastPaidOn: dateOnly(data.paidOn),
            renewsOn: dateOnly(nextRenewal),
          },
        });
        return { id: subscription.id, expenseId, nextRenewal };
      }),
    );
  } catch (error) {
    if (error instanceof AppError && error.message === "Bu kayıt zaten var.") {
      throw new AppError("Bu dönem için ödeme zaten kayıtlı.", "CONFLICT", 409);
    }
    throw error;
  }
}
