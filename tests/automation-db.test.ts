// @vitest-environment node
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import { JOB_DEFINITIONS } from "@/server/automation/catalog";
import { ensureAutomationJobs, runDueJob } from "@/server/automation/engine";
import { runGmailAnalysis, runInvoiceScan, runMealClose } from "@/server/automation/handlers";
import { invoiceSummary } from "@/server/google/invoices";
import { istanbulInstant } from "@/server/automation/schedule";
import { getPrisma } from "@/server/db";
import { decideAgentAction } from "@/server/services/automation";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const jobKeys = ["faz7-once", "faz7-retry", "faz7-lock", "faz7-gmail", "faz7-parallel"];

async function createDueJob(key: string, scheduledFor: Date) {
  const db = getPrisma();
  return db.automationJob.create({
    data: {
      key,
      name: key,
      agent: "operations",
      timezone: "Europe/Istanbul",
      weekdays: [],
      hour: 8,
      minute: 30,
      state: "ACTIVE",
      nextRunAt: scheduledFor,
      scheduledFor,
      maxRetries: 3,
    },
  });
}

describe.skipIf(!databaseReady)("otomasyon veritabanı", () => {
  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    const db = getPrisma();
    await db.automationJob.deleteMany({ where: { key: { in: jobKeys } } });
    await db.panelNotice.deleteMany({
      where: { dedupeKey: { in: ["ops.meal-close:2099-01-05", "ops.leave-pending:2099-01-06", "ops.renewals:2099-01-06"] } },
    });
    await db.agentActionRequest.deleteMany({ where: { summary: { startsWith: "Faz7" } } });
    await db.user.deleteMany({ where: { email: { startsWith: "faz7-", endsWith: "@example.invalid" } } });
  });

  it("tanımlı görevleri saklar ve yeniden açılışta sonraki zamanı silmez", async () => {
    const db = getPrisma();
    const now = istanbulInstant("2026-10-21", 7, 0);
    await ensureAutomationJobs(db, now);
    const first = await db.automationJob.findUnique({ where: { key: "gmail.morning" } });
    expect(first?.state).toBe("WAITING_CONNECTION");
    expect(first?.timezone).toBe("Europe/Istanbul");
    await ensureAutomationJobs(db, istanbulInstant("2026-10-22", 12, 0));
    const second = await db.automationJob.findUnique({ where: { key: "gmail.morning" } });
    expect(second?.nextRunAt.getTime()).toBe(first?.nextRunAt.getTime());
    expect(await db.automationJob.count({ where: { key: { in: JOB_DEFINITIONS.map((job) => job.key) } } })).toBe(
      JOB_DEFINITIONS.length,
    );
  });

  it("aynı pencereyi bir kez çalıştırır, hatada yeniden dener ve eski kilidi devralır", async () => {
    const db = getPrisma();
    const parked = await db.automationJob.findMany({
      where: { NOT: { key: { startsWith: "faz7-" } } },
    });
    const far = istanbulInstant("2099-06-01", 8, 0);
    if (parked.length > 0) {
      await db.automationJob.updateMany({
        where: { id: { in: parked.map((job) => job.id) } },
        data: { nextRunAt: far, scheduledFor: far },
      });
    }
    const slot = istanbulInstant("2026-10-21", 8, 30);
    const now = new Date(slot.getTime() + 60_000);
    try {
    await createDueJob("faz7-once", slot);
    let calls = 0;
    const handlers = {
      "faz7-once": async () => {
        calls += 1;
        return { state: "SUCCEEDED" as const, summary: "tamam" };
      },
    };
    expect(await runDueJob(db, now, { handlers })).toBe("executed");
    await db.automationJob.update({
      where: { key: "faz7-once" },
      data: { nextRunAt: slot, scheduledFor: slot, lockToken: null, lockedUntil: null },
    });
    expect(await runDueJob(db, now, { handlers })).toBe("advanced");
    expect(await runDueJob(db, now, { handlers })).toBe("idle");
    expect(calls).toBe(1);

    await createDueJob("faz7-retry", slot);
    let failures = 0;
    const failing = {
      "faz7-retry": async () => {
        failures += 1;
        throw new Error("deneme hatası");
      },
    };
    expect(await runDueJob(db, now, { handlers: failing, retryDelayMs: () => 0 })).toBe("executed");
    expect(await runDueJob(db, now, { handlers: failing, retryDelayMs: () => 0 })).toBe("executed");
    expect(await runDueJob(db, now, { handlers: failing, retryDelayMs: () => 0 })).toBe("executed");
    expect(await runDueJob(db, now, { handlers: failing, retryDelayMs: () => 0 })).toBe("idle");
    expect(failures).toBe(3);
    const failed = await db.automationRun.findFirst({ where: { job: { key: "faz7-retry" } } });
    expect(failed?.state).toBe("FAILED");
    expect(failed?.attempt).toBe(3);

    const locked = await createDueJob("faz7-lock", slot);
    await db.automationJob.update({
      where: { id: locked.id },
      data: { lockToken: "eski", lockedUntil: new Date(now.getTime() - 60_000) },
    });
    let recovered = 0;
    expect(
      await runDueJob(db, now, {
        handlers: {
          "faz7-lock": async () => {
            recovered += 1;
            return { state: "SUCCEEDED" as const, summary: "kilit açıldı" };
          },
        },
      }),
    ).toBe("executed");
    expect(recovered).toBe(1);
    } finally {
      for (const job of parked) {
        await db.automationJob.update({
          where: { id: job.id },
          data: { nextRunAt: job.nextRunAt, scheduledFor: job.scheduledFor },
        });
      }
    }
  });

  it("bağlantısız Gmail ve fatura görevini okumuş gibi kaydetmez", async () => {
    const db = getPrisma();
    const invoicesBefore = await db.invoice.count();
    const actionsBefore = await db.agentActionRequest.count();
    const account = await db.googleAccount.findUnique({ where: { id: "default" }, select: { status: true } });
    if (account?.status === "CONNECTED") {
      expect(invoiceSummary({
        connected: false,
        aiConfigured: false,
        scannedAt: null,
        found: 0,
        queued: 0,
        processed: [],
        needsApproval: [],
        imported: [],
        duplicates: [],
        rejected: [],
        errors: [],
        retryable: 0,
        statements: 0,
        driveUploaded: false,
        archivePattern: "",
      })).toContain("Drive");
    } else {
      const fetchImpl: typeof fetch = async () => {
        throw new Error("Gmail çağrılmamalı");
      };
      const gmail = await runGmailAnalysis(db, { fetchImpl });
      const invoice = await runInvoiceScan(db, { fetchImpl });
      expect(gmail.state).toBe("WAITING_CONNECTION");
      expect(gmail.summary).toContain("Posta okunmadı");
      expect(invoice.state).toBe("WAITING_CONNECTION");
      expect(invoice.summary).toContain("Drive");
    }
    expect(await db.invoice.count()).toBe(invoicesBefore);
    expect(await db.agentActionRequest.count()).toBe(actionsBefore);

    const slot = istanbulInstant("2099-01-05", 10, 30);
    const first = await runMealClose(db, slot);
    const second = await runMealClose(db, slot);
    expect(first.state).toBe("SUCCEEDED");
    expect(second.summary).toBe(first.summary);
    expect(await db.panelNotice.count({ where: { dedupeKey: "ops.meal-close:2099-01-05" } })).toBe(1);
    const notice = await db.panelNotice.findUnique({ where: { dedupeKey: "ops.meal-close:2099-01-05" } });
    expect(notice?.delivered).toBe(false);
    expect(notice?.channel).toBe("PANEL");
  });

  it("onaylanan Gmail işlemini bağlantı yokken durdurur", async () => {
    const db = getPrisma();
    const passwordHash = await hashPassword(`Test-${randomUUID()}!a1`);
    const adminRow = await db.user.create({
      data: {
        email: `faz7-${randomUUID()}@example.invalid`,
        name: "Faz7 Yonetici",
        role: "ADMIN",
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    const admin: Actor = adminRow;
    const action = await db.agentActionRequest.create({
      data: { kind: "GMAIL_SEND", summary: "Faz7 gonderim denemesi" },
    });
    const decided = await decideAgentAction(admin, action.id, "APPROVED");
    expect(decided.state).toBe("BLOCKED");
    const stored = await db.agentActionRequest.findUnique({ where: { id: action.id } });
    expect(stored?.state).toBe("BLOCKED");
    expect(stored?.decisionNote).toContain("çalıştırılmadı");
  });
});
