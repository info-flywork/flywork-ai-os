// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/server/auth/password";
import { dateOnly } from "@/server/dates";
import { getDashboardSummary, invoiceReviewMonthWhere } from "@/server/dashboard/summary";
import { getPrisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { addIsoDays, istanbulClock } from "@/server/meals/schedule";
import { getAutomationPage } from "@/server/services/automation";
import { getTechnologyPage } from "@/server/services/technology";
import { changeOwnPassword, updateUser } from "@/server/services/users";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const fixtureIds = [];
let menuId = null;

function fixtureEmail() {
  return `faz8-${randomUUID()}@example.invalid`;
}

function mealDate() {
  let iso = "2098-06-01";
  for (let index = 0; index < 21; index += 1) {
    const weekday = istanbulClock(new Date(`${iso}T12:00:00+03:00`)).weekday;
    if (weekday === 1 || weekday === 2 || weekday === 4) {
      return iso;
    }
    iso = addIsoDays(iso, 1);
  }
  return iso;
}

async function expectCode(work, code) {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error ).code).toBe(code);
    return;
  }
  throw new Error(`Beklenen hata oluşmadı: ${code}`);
}

describe.skipIf(!databaseReady)("dashboard ve kullanıcı", () => {
  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    const db = getPrisma();
    await db.invoiceReview.deleteMany({ where: { fileName: { startsWith: "faz8-" } } });
    await db.automationRun.deleteMany({ where: { windowKey: { startsWith: "faz8-" } } });
    if (menuId) {
      await db.mealOrder.deleteMany({ where: { menuId } });
      await db.mealMenuItem.deleteMany({ where: { menuId } });
      await db.mealMenu.deleteMany({ where: { id: menuId } });
    }
    const leftovers = await db.user.findMany({
      where: { email: { startsWith: "faz8-", endsWith: "@example.invalid" } },
      select: { id: true },
    });
    const userIds = [...new Set([...fixtureIds, ...leftovers.map((user) => user.id)])];
    if (userIds.length > 0) {
      await db.mealOrder.deleteMany({ where: { userId: { in: userIds } } });
      await db.leaveRequest.deleteMany({ where: { userId: { in: userIds } } });
      await db.expense.deleteMany({ where: { userId: { in: userIds } } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  it("şirket özetini personelden ayırır ve para birimlerini karıştırmaz", async () => {
    const db = getPrisma();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz8 Yonetici ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz8 Calisan ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const otherRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz8 Diger ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id, otherRow.id);
    const admin = adminRow;
    const employee = employeeRow;
    const iso = mealDate();
    const now = new Date(`${iso}T12:00:00+03:00`);
    const spentOn = dateOnly(iso);

    await db.expense.createMany({
      data: [
        {
          userId: employee.id,
          scope: "EMPLOYEE",
          category: "TRANSPORT",
          title: "Faz8 Ulasim",
          amount: "10.00",
          currency: "TRY",
          spentOn,
          status: "APPROVED",
        },
        {
          userId: otherRow.id,
          scope: "EMPLOYEE",
          category: "TRANSPORT",
          title: "Faz8 Diger",
          amount: "20.00",
          currency: "TRY",
          spentOn,
          status: "APPROVED",
        },
        {
          userId: admin.id,
          scope: "COMPANY",
          category: "SOFTWARE",
          title: "Faz8 Yazilim",
          amount: "5.00",
          currency: "USD",
          spentOn,
          status: "PAID",
        },
        {
          userId: employee.id,
          scope: "EMPLOYEE",
          category: "MEAL",
          title: "Faz8 Bekleyen",
          amount: "7.00",
          currency: "EUR",
          spentOn,
          status: "SUBMITTED",
        },
      ],
    });
    await db.leaveRequest.createMany({
      data: [employee.id, otherRow.id].map((userId) => ({
        userId,
        type: "ANNUAL" ,
        duration: "FULL_DAY" ,
        startDate: spentOn,
        endDate: spentOn,
        startsAt: now,
        endsAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
        dayCount: "1.00",
        status: "PENDING" ,
      })),
    });
    const menu = await db.mealMenu.create({
      data: {
        date: spentOn,
        note: "Faz8",
        published: true,
        items: {
          create: [
            { name: "Faz8 Tavuk", sortOrder: 0 },
            { name: "Faz8 Corba", sortOrder: 1 },
          ],
        },
      },
      include: { items: true },
    });
    menuId = menu.id;
    const tavuk = menu.items.find((item) => item.name === "Faz8 Tavuk");
    const corba = menu.items.find((item) => item.name === "Faz8 Corba");
    await db.mealOrder.create({ data: { userId: employee.id, menuId: menu.id, itemId: tavuk.id, status: "RECEIVED" } });
    await db.mealOrder.create({ data: { userId: otherRow.id, menuId: menu.id, itemId: corba.id, status: "RECEIVED" } });

    const pendingBefore = await db.invoiceReview.count({
      where: {
        status: "PENDING",
        documentType: { not: "STATEMENT" },
        ...invoiceReviewMonthWhere(iso.slice(0, 7)),
      },
    });
    const invoice = await db.invoiceReview.create({
      data: {
        status: "PENDING",
        issuedOn: spentOn,
        contentHash: `faz8-${randomUUID()}`,
        storageKey: `faz8-${randomUUID()}`,
        fileName: "faz8-fatura.pdf",
        sizeBytes: 12,
        documentType: "INVOICE",
        aiSnapshot: {},
      },
    });
    const statement = await db.invoiceReview.create({
      data: {
        status: "PENDING",
        contentHash: `faz8-${randomUUID()}`,
        storageKey: `faz8-${randomUUID()}`,
        fileName: "faz8-ekstre.pdf",
        sizeBytes: 12,
        documentType: "STATEMENT",
        aiSnapshot: {},
      },
    });
    const job = await db.automationJob.findUnique({ where: { key: "invoice.daily" } });
    const run = job
      ? await db.automationRun.create({
          data: {
            jobId: job.id,
            windowKey: `faz8-${randomUUID()}`,
            attempt: 1,
            state: "FAILED",
            startedAt: new Date(),
            finishedAt: new Date(),
            error: "Faz8 deneme hatasi",
            summary: "Faz8 ozet",
          },
        })
      : null;

    try {
      const company = await getDashboardSummary(admin, now);
      const own = await getDashboardSummary(employee, now);
      expect(company.scope).toBe("company");
      expect(own.scope).toBe("self");
      expect(company.month).toBe(iso.slice(0, 7));
      expect(company.monthlyExpenses.find((row) => row.currency === "TRY")).toMatchObject({ total: "30.00", count: 2 });
      expect(company.monthlyExpenses.find((row) => row.currency === "USD")).toMatchObject({ total: "5.00", count: 1 });
      expect(company.monthlyExpenses.find((row) => row.currency === "EUR")).toMatchObject({ total: "0.00", count: 0 });
      expect(own.monthlyExpenses.find((row) => row.currency === "TRY")).toMatchObject({ total: "10.00", count: 1 });
      expect(own.monthlyExpenses.find((row) => row.currency === "USD")?.count).toBe(0);
      expect(company.invoicesPending).toBe(pendingBefore + 1);
      expect(own.invoicesPending).toBeNull();
      expect(own.recentRuns).toBeNull();
      expect(own.upcomingRenewals).toEqual([]);
      expect(company.leave.pending).toBeGreaterThanOrEqual(2);
      expect(own.leave.pending).toBe(1);
      expect(own.leave.requests.map((request) => request.name)).toEqual(["Sizin talebiniz"]);
      expect(JSON.stringify(own)).not.toContain(otherRow.name);
      expect(JSON.stringify(own)).not.toContain("faz8-ekstre");
      expect(company.meal.serviceDay).toBe(true);
      expect(company.meal.total).toBe(2);
      expect(company.meal.items).toEqual(expect.arrayContaining([
        { name: "Faz8 Tavuk", count: 1 },
        { name: "Faz8 Corba", count: 1 },
      ]));
      expect(own.meal.total).toBe(1);
      expect(own.meal.ownItem).toBe("Faz8 Tavuk");
      expect(own.meal.items.find((item) => item.name === "Faz8 Corba")?.count).toBe(0);
      if (run) {
        expect(company.recentRuns?.some((item) => item.id === run.id && item.state === "FAILED")).toBe(true);
        expect(JSON.stringify(own)).not.toContain("Faz8 deneme hatasi");
      }
      expect(company.recentRuns === null).toBe(false);

      await expectCode(() => getTechnologyPage(employee, {}), "FORBIDDEN");
      await expectCode(() => getAutomationPage(employee), "FORBIDDEN");
      await expectCode(() => updateUser(employee, { userId: employee.id, name: "Faz8 Yetkisiz", role: "EMPLOYEE" }), "FORBIDDEN");
      const renamed = await updateUser(admin, { userId: employee.id, name: "Faz8 Yeni Ad", role: "EMPLOYEE" });
      expect(renamed.name).toBe("Faz8 Yeni Ad");
      expect(renamed).not.toHaveProperty("passwordHash");
      const nextPassword = `Test-${randomBytes(4).toString("hex")}!b2`;
      await updateUser(admin, { userId: employee.id, name: "Faz8 Yeni Ad", role: "ADMIN", password: nextPassword });
      const stored = await db.user.findUnique({ where: { id: employee.id }, select: { role: true, passwordHash: true } });
      expect(stored?.role).toBe("ADMIN");
      expect(await verifyPassword(nextPassword, stored.passwordHash)).toBe(true);
      await updateUser(admin, { userId: employee.id, name: "Faz8 Yeni Ad", role: "EMPLOYEE" });
      await expectCode(
        () => updateUser(admin, { userId: employee.id, name: "Faz8 Yeni Ad", role: "EMPLOYEE", password: "kisa" }),
        "VALIDATION",
      );
      expect(invoice.id).toBeTruthy();
      expect(statement.documentType).toBe("STATEMENT");
    } finally {
      await db.invoiceReview.deleteMany({ where: { id: { in: [invoice.id, statement.id] } } });
      if (run) {
        await db.automationRun.delete({ where: { id: run.id } });
      }
    }
  });

  it("çalışan kendi şifresini değiştirir ve diğer oturumunu kapatır", async () => {
    const db = getPrisma();
    const current = `Test-${randomBytes(4).toString("hex")}!a1`;
    const next = `Test-${randomBytes(4).toString("hex")}!b2`;
    const row = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: "Faz8 Sifre",
        role: "EMPLOYEE",
        passwordHash: await hashPassword(current),
      },
    });
    fixtureIds.push(row.id);
    const kept = await db.session.create({
      data: { userId: row.id, tokenHash: `faz8-keep-${randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) },
    });
    const other = await db.session.create({
      data: { userId: row.id, tokenHash: `faz8-drop-${randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) },
    });
    const actor = {
      id: row.id,
      role: "EMPLOYEE",
      email: row.email,
      name: row.name,
      approver: false,
      mealOnly: false,
    };
    await expectCode(
      () => changeOwnPassword(actor, { currentPassword: "yanlis", newPassword: next, confirmPassword: next }, kept.tokenHash),
      "VALIDATION",
    );
    await changeOwnPassword(
      actor,
      { currentPassword: current, newPassword: next, confirmPassword: "baska" },
      kept.tokenHash,
    ).then(
      () => {
        throw new Error("Tekrar uyuşmazlığı geçti");
      },
      (error) => {
        expect(error).toBeInstanceOf(AppError);
        expect((error ).code).toBe("VALIDATION");
      },
    );
    await changeOwnPassword(actor, { currentPassword: current, newPassword: next, confirmPassword: next }, kept.tokenHash);
    const stored = await db.user.findUnique({ where: { id: row.id }, select: { passwordHash: true } });
    expect(await verifyPassword(next, stored.passwordHash)).toBe(true);
    expect(await verifyPassword(current, stored.passwordHash)).toBe(false);
    const sessions = await db.session.findMany({ where: { userId: row.id }, select: { id: true, revokedAt: true } });
    expect(sessions.find((item) => item.id === kept.id)?.revokedAt).toBeNull();
    expect(sessions.find((item) => item.id === other.id)?.revokedAt).not.toBeNull();
    await expectCode(
      () => changeOwnPassword(actor, { currentPassword: next, newPassword: next, confirmPassword: next }, kept.tokenHash),
      "VALIDATION",
    );
  });
});
