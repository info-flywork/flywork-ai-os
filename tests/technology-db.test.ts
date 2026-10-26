// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import { istanbulToday, toIsoDate } from "@/server/dates";
import { getPrisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createExpense } from "@/server/services/finance";
import {
  getTechnologyPage,
  recordSubscriptionPayment,
  saveTechnology,
  setTechnologyStatus,
  syncTechnologyNotices,
} from "@/server/services/technology";
import { addCycle } from "@/server/technology/schedule";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const fixtureIds: string[] = [];

function fixtureEmail() {
  return `faz6-${randomUUID()}@example.invalid`;
}

function shift(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function expectCode(work: () => Promise<unknown>, code: string) {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`Beklenen hata oluşmadı: ${code}`);
}

describe.skipIf(!databaseReady)("teknoloji veritabanı", () => {
  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    const db = getPrisma();
    const leftovers = await db.user.findMany({
      where: { email: { startsWith: "faz6-", endsWith: "@example.invalid" } },
      select: { id: true },
    });
    const userIds = [...new Set([...fixtureIds, ...leftovers.map((user) => user.id)])];
    await db.technologySubscription.deleteMany({ where: { name: { startsWith: "Faz6" } } });
    if (userIds.length > 0) {
      await db.expense.deleteMany({ where: { userId: { in: userIds } } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  it("hizmeti saklar, ödemeyi bir kez gidere bağlar ve hatırlatmayı tekrarlamaz", async () => {
    const db = getPrisma();
    const namedBefore = await db.technologySubscription.count({
      where: { name: { in: ["Cursor Pro", "Rive"] } },
    });
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz6 Yonetici ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz6 Calisan ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id);
    const admin: Actor = adminRow;
    const employee: Actor = employeeRow;
    const today = istanbulToday();
    await expectCode(() => getTechnologyPage(employee, {}), "FORBIDDEN");

    const domain = await saveTechnology(admin, null, {
      name: "Faz6 Alan",
      vendor: "Faz6 Kayit",
      kind: "DOMAIN",
      status: "ACTIVE",
      project: "Flywork",
      ownerId: admin.id,
      amount: "20.00",
      currency: "EUR",
      billingCycle: "YEARLY",
      renewsOn: addCycle(today, "CUSTOM", 400),
      paymentMethod: "TRANSFER",
      autoRenew: true,
      domainName: "faz6.example",
      registrar: "Faz6 Kayit",
      domainExpiresOn: shift(today, 5),
      websiteUrl: "https://faz6.example",
    });
    const tool = await saveTechnology(admin, null, {
      name: "Faz6 Arac",
      vendor: "Faz6 Saglayici",
      kind: "SOFTWARE",
      status: "ACTIVE",
      description: "Test araci",
      amount: "50.00",
      currency: "USD",
      billingCycle: "MONTHLY",
      renewsOn: today,
      paymentMethod: "CARD",
      cardLast4: "4242",
      autoRenew: false,
    });
    await saveTechnology(admin, tool.id, {
      name: "Faz6 Arac",
      vendor: "Faz6 Saglayici",
      kind: "SOFTWARE",
      status: "ACTIVE",
      amount: "50.00",
      currency: "USD",
      billingCycle: "MONTHLY",
      renewsOn: today,
      paymentMethod: "CARD",
      cardLast4: "4242",
      autoRenew: true,
    });

    const page = await getTechnologyPage(admin, { query: "Faz6 Arac", currency: "USD" });
    expect(page.subscriptions).toHaveLength(1);
    expect(page.subscriptions[0]?.cardLast4).toBe("4242");
    expect(page.subscriptions[0]?.autoRenew).toBe(true);
    expect(
      await db.subscriptionNotice.count({
        where: { subscriptionId: domain.id, subject: "DOMAIN", thresholdDays: 10 },
      }),
    ).toBe(1);
    expect(
      await db.subscriptionNotice.count({
        where: { subscriptionId: domain.id, subject: "DOMAIN", thresholdDays: 5 },
      }),
    ).toBe(1);
    const noticeCount = await db.subscriptionNotice.count({ where: { subscriptionId: domain.id } });
    await syncTechnologyNotices(admin);
    expect(await db.subscriptionNotice.count({ where: { subscriptionId: domain.id } })).toBe(noticeCount);

    await expectCode(
      () =>
        recordSubscriptionPayment(admin, {
          subscriptionId: tool.id,
          periodEnd: today,
          paidOn: shift(today, 3),
          amount: "50.00",
          currency: "USD",
          createExpense: true,
        }),
      "VALIDATION",
    );
    expect(await db.expense.count({ where: { userId: admin.id, title: "Faz6 Arac" } })).toBe(0);

    const paid = await recordSubscriptionPayment(admin, {
      subscriptionId: tool.id,
      periodEnd: today,
      paidOn: today,
      amount: "50.00",
      currency: "USD",
      createExpense: true,
    });
    expect(paid.expenseId).toBeTruthy();
    expect(paid.nextRenewal).toBe(addCycle(today, "MONTHLY"));
    await expectCode(
      () =>
        recordSubscriptionPayment(admin, {
          subscriptionId: tool.id,
          periodEnd: today,
          paidOn: today,
          amount: "50.00",
          currency: "USD",
          createExpense: true,
        }),
      "CONFLICT",
    );
    expect(await db.expense.count({ where: { userId: admin.id, title: "Faz6 Arac" } })).toBe(1);

    const existing = await createExpense(admin, {
      scope: "COMPANY",
      category: "SUBSCRIPTION",
      title: "Faz6 Bag",
      vendor: "Faz6 Saglayici",
      amount: "20.00",
      currency: "EUR",
      paymentMethod: "TRANSFER",
      spentOn: today,
    });
    await recordSubscriptionPayment(admin, {
      subscriptionId: domain.id,
      periodEnd: addCycle(today, "CUSTOM", 400),
      paidOn: today,
      amount: "20.00",
      currency: "EUR",
      createExpense: false,
      expenseId: existing.id,
    });
    expect(await db.expense.count({ where: { id: existing.id } })).toBe(1);
    const renewal = await db.subscriptionRenewal.findFirst({ where: { expenseId: existing.id } });
    expect(renewal?.subscriptionId).toBe(domain.id);

    const report = await getTechnologyPage(admin, { month: today.slice(0, 7) });
    const usd = report.realizedMonth.find((row) => row.currency === "USD");
    const eur = report.realizedMonth.find((row) => row.currency === "EUR");
    expect(usd?.currency).toBe("USD");
    expect(eur?.currency).toBe("EUR");
    expect(usd?.total).not.toBe(eur?.total);
    expect(await db.subscriptionRenewal.count({ where: { subscriptionId: tool.id } })).toBe(1);
    expect(report.plannedMonth.some((row) => row.currency === "USD" && row.total === "50.00")).toBe(false);
    const stored = await db.technologySubscription.findUnique({ where: { id: tool.id } });
    expect(stored ? toIsoDate(stored.renewsOn) > today : false).toBe(true);

    await setTechnologyStatus(admin, { subscriptionId: tool.id, status: "INACTIVE" });
    const inactive = await db.technologySubscription.findUnique({ where: { id: tool.id } });
    expect(inactive?.active).toBe(false);
    expect(inactive?.status).toBe("INACTIVE");
    expect(await db.technologySubscription.count({ where: { name: { in: ["Cursor Pro", "Rive"] } } })).toBe(namedBefore);
  });
});
