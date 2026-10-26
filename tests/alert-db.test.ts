// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import { dateOnly } from "@/server/dates";
import { getPrisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { listAlerts, markAlertRead } from "@/server/services/alerts";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const fixtureIds: string[] = [];

function fixtureEmail() {
  return `faz9-${randomUUID()}@example.invalid`;
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

describe.skipIf(!databaseReady)("bildirim merkezi", () => {
  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    const db = getPrisma();
    await db.invoiceReview.deleteMany({ where: { fileName: { startsWith: "faz9-" } } });
    await db.automationRun.deleteMany({ where: { windowKey: { startsWith: "faz9-" } } });
    await db.technologySubscription.deleteMany({ where: { name: { startsWith: "Faz9" } } });
    const leftovers = await db.user.findMany({
      where: { email: { startsWith: "faz9-", endsWith: "@example.invalid" } },
      select: { id: true },
    });
    const userIds = [...new Set([...fixtureIds, ...leftovers.map((user) => user.id)])];
    if (userIds.length > 0) {
      await db.leaveRequest.deleteMany({ where: { userId: { in: userIds } } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.panelAlertRead.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  it("aynı olayı bir kez gösterir, ekstre ve uzak yenilemeyi ayırır", async () => {
    const db = getPrisma();
    const namedBefore = await db.technologySubscription.count({
      where: { name: { in: ["Cursor Pro", "Rive"] } },
    });
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz9 Yonetici ${randomUUID().slice(0, 8)}`,
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz9 Calisan ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const otherRow = await db.user.create({
      data: {
        email: fixtureEmail(),
        name: `Faz9 Diger ${randomUUID().slice(0, 8)}`,
        role: "EMPLOYEE",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id, otherRow.id);
    const admin: Actor = adminRow;
    const employee: Actor = employeeRow;
    const now = new Date("2098-06-01T12:00:00+03:00");
    const near = dateOnly("2098-06-15");
    const far = dateOnly("2099-06-01");
    const leaveStart = new Date("2098-06-10T09:00:00+03:00");

    await db.technologySubscription.create({
      data: {
        name: "Faz9 Yakin",
        vendor: "Faz9",
        kind: "SOFTWARE",
        amount: "10.00",
        currency: "TRY",
        billingCycle: "MONTHLY",
        renewsOn: near,
        status: "ACTIVE",
        active: true,
      },
    });
    await db.technologySubscription.create({
      data: {
        name: "Faz9 Uzak",
        vendor: "Faz9",
        kind: "SOFTWARE",
        amount: "10.00",
        currency: "USD",
        billingCycle: "YEARLY",
        renewsOn: far,
        status: "ACTIVE",
        active: true,
      },
    });
    const ownLeave = await db.leaveRequest.create({
      data: {
        userId: employee.id,
        type: "ANNUAL",
        duration: "FULL_DAY",
        startDate: dateOnly("2098-06-10"),
        endDate: dateOnly("2098-06-10"),
        startsAt: leaveStart,
        endsAt: new Date(leaveStart.getTime() + 8 * 60 * 60 * 1000),
        dayCount: "1.00",
        status: "PENDING",
      },
    });
    await db.leaveRequest.create({
      data: {
        userId: otherRow.id,
        type: "EXCUSE",
        duration: "FULL_DAY",
        startDate: dateOnly("2098-06-11"),
        endDate: dateOnly("2098-06-11"),
        startsAt: leaveStart,
        endsAt: new Date(leaveStart.getTime() + 8 * 60 * 60 * 1000),
        dayCount: "1.00",
        status: "PENDING",
      },
    });
    const invoice = await db.invoiceReview.create({
      data: {
        status: "PENDING",
        contentHash: `faz9-${randomUUID()}`,
        storageKey: `faz9-${randomUUID()}`,
        fileName: "faz9-fatura.pdf",
        sizeBytes: 8,
        documentType: "INVOICE",
        aiSnapshot: {},
      },
    });
    const statement = await db.invoiceReview.create({
      data: {
        status: "PENDING",
        contentHash: `faz9-${randomUUID()}`,
        storageKey: `faz9-${randomUUID()}`,
        fileName: "faz9-ekstre.pdf",
        sizeBytes: 8,
        documentType: "STATEMENT",
        aiSnapshot: {},
      },
    });
    const job = await db.automationJob.findUnique({ where: { key: "invoice.morning" } });
    const run = job
      ? await db.automationRun.create({
          data: {
            jobId: job.id,
            windowKey: `faz9-${randomUUID()}`,
            attempt: 1,
            state: "FAILED",
            startedAt: new Date("2098-06-01T09:00:00+03:00"),
            finishedAt: new Date("2098-06-01T09:01:00+03:00"),
            error: "Faz9 tarama hatasi",
            summary: "Faz9 ozet",
          },
        })
      : null;

    try {
      const company = await listAlerts(admin, now);
      const own = await listAlerts(employee, now);
      const invoiceKey = `invoice.review:${invoice.id}`;
      expect(company.filter((alert) => alert.key === invoiceKey)).toHaveLength(1);
      expect(company.find((alert) => alert.key === invoiceKey)?.href).toBe(`/otomasyon/inceleme/${invoice.id}`);
      expect(company.some((alert) => alert.key === `invoice.review:${statement.id}`)).toBe(false);
      expect(company.some((alert) => alert.body.includes("Faz9 Yakin") && alert.body.includes("2098-06-15"))).toBe(true);
      expect(company.some((alert) => alert.body.includes("Faz9 Uzak"))).toBe(false);
      expect(company.some((alert) => alert.key.startsWith("technology.draft:"))).toBe(false);
      expect(own.some((alert) => alert.key.startsWith("invoice.review:"))).toBe(false);
      expect(own.some((alert) => alert.key.startsWith("technology.draft:"))).toBe(false);
      expect(own.some((alert) => alert.key.startsWith("automation.failed:"))).toBe(false);
      expect(own.map((alert) => alert.key)).toEqual([`leave.request:${ownLeave.id}`]);
      expect(JSON.stringify(own)).not.toContain(otherRow.name);
      expect(JSON.stringify(own)).not.toContain("faz9-ekstre");
      if (run) {
        const failed = company.filter((alert) => alert.key === `automation.failed:${run.id}`);
        expect(failed).toHaveLength(1);
        expect(failed[0]?.href).toBe("/otomasyon");
      }
      expect(await db.technologySubscription.count({ where: { name: { in: ["Cursor Pro", "Rive"] } } })).toBe(namedBefore);

      await markAlertRead(admin, invoiceKey, now);
      await markAlertRead(admin, invoiceKey, now);
      expect(await db.panelAlertRead.count({
        where: { userId: admin.id, dedupeKey: invoiceKey },
      })).toBe(1);
      const reread = await listAlerts(admin, now);
      expect(reread.find((alert) => alert.key === invoiceKey)?.read).toBe(true);
      await expectCode(() => markAlertRead(employee, invoiceKey, now), "NOT_FOUND");
    } finally {
      await db.invoiceReview.deleteMany({ where: { id: { in: [invoice.id, statement.id] } } });
      if (run) {
        await db.automationRun.delete({ where: { id: run.id } });
      }
    }
  });
});
