// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";

import { hashPassword } from "@/server/auth/password";
import { dateOnly } from "@/server/dates";
import { getPrisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { dispatchTelegramBatch, dispatchTelegramMessage } from "@/server/telegram/dispatch";
import { handleTelegramUpdate } from "@/server/telegram/commands";
import { leaveCallback } from "@/server/telegram/messages";
import { loadMealCloseNotice, loadOperationalNotices } from "@/server/telegram/notices";
import { createTelegramPairing, consumeTelegramPairing, hashPairingCode } from "@/server/telegram/pairing";
import { receiveTelegramWebhook } from "@/app/api/telegram/webhook/route";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const fixtureIds = [];
const receiptIds = [];
const adminTelegramId = 7000000000 + Math.floor(Math.random() * 1000000);
const employeeTelegramId = adminTelegramId + 1000000;

function fixtureEmail() {
  return `faz10-${randomUUID()}@example.invalid`;
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

function privateUpdate(text, telegramUserId = adminTelegramId) {
  return { message: { text, from: { id: telegramUserId }, chat: { id: telegramUserId } } };
}

function decisionUpdate(data, telegramUserId = adminTelegramId) {
  return {
    callback_query: {
      id: `faz10-${data}`,
      data,
      from: { id: telegramUserId },
      message: { chat: { id: telegramUserId } },
    },
  };
}

async function removeFixtures() {
  const db = getPrisma();
  await db.telegramDispatch.deleteMany({ where: { dedupeKey: { startsWith: "faz10-" } } });
  await db.telegramDispatch.deleteMany({ where: { dedupeKey: { startsWith: "meal.close:2098-06-02" } } });
  await db.mealOrder.deleteMany({ where: { user: { email: { startsWith: "faz10-" } } } });
  await db.mealMenuItem.deleteMany({ where: { menu: { note: "faz10" } } });
  await db.mealMenu.deleteMany({ where: { note: "faz10" } });
  await db.invoiceReview.deleteMany({ where: { fileName: { startsWith: "faz10-" } } });
  await db.automationRun.deleteMany({ where: { windowKey: { startsWith: "faz10-" } } });
  await db.technologySubscription.deleteMany({ where: { name: { startsWith: "Faz10" } } });
  const leftovers = await db.user.findMany({
    where: { email: { startsWith: "faz10-", endsWith: "@example.invalid" } },
    select: { id: true },
  });
  const userIds = [...new Set([...fixtureIds, ...leftovers.map((user) => user.id)])];
  if (userIds.length > 0) {
    await db.leaveRequest.deleteMany({ where: { userId: { in: userIds } } });
    await db.session.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
  const dispatches = await db.telegramDispatch.findMany({ select: { id: true, kind: true, dedupeKey: true } });
  const stale = [];
  for (const row of dispatches) {
    const id = row.dedupeKey.split(":")[1];
    if (!id) {
      continue;
    }
    const found = row.kind === "invoice.review"
      ? await db.invoiceReview.findUnique({ where: { id }, select: { id: true } })
      : row.kind === "subscription.renewal"
        ? await db.technologySubscription.findUnique({ where: { id }, select: { id: true } })
        : row.kind === "automation.failed"
          ? await db.automationRun.findUnique({ where: { id }, select: { id: true } })
          : { id: "keep" };
    if (!found) {
      stale.push(row.id);
    }
  }
  if (stale.length > 0) {
    await db.telegramDispatch.deleteMany({ where: { id: { in: stale } } });
  }
  if (receiptIds.length > 0) {
    await db.telegramUpdateReceipt.deleteMany({ where: { updateId: { in: receiptIds } } });
    receiptIds.length = 0;
  }
}

describe.skipIf(!databaseReady)("telegram altyapısı", () => {
  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    await removeFixtures();
  });

  it("yöneticiyi eşler, izni kaydeder ve aynı bildirimi bir kez hazırlar", async () => {
    await removeFixtures();
    const db = getPrisma();
    const namedBefore = await db.technologySubscription.count({ where: { name: { in: ["Cursor Pro", "Rive"] } } });
    const realReviewsBefore = await db.invoiceReview.count({ where: { fileName: { not: { startsWith: "faz10-" } } } });
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`);
    const adminRow = await db.user.create({
      data: { email: fixtureEmail(), name: "Faz10 Yonetici", role: "ADMIN", passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: { email: fixtureEmail(), name: "Faz10 Calisan", role: "EMPLOYEE", passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });
    const otherRow = await db.user.create({
      data: { email: fixtureEmail(), name: "Faz10 Diger", role: "EMPLOYEE", passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id, otherRow.id);
    const admin = adminRow;
    const employee = employeeRow;
    const now = new Date("2098-06-01T12:00:00+03:00");
    const leaveStart = new Date("2098-06-10T09:00:00+03:00");
    const leaveEnd = new Date("2098-06-10T17:00:00+03:00");

    const employeePairing = await createTelegramPairing(employee);
    expect(employeePairing.code).toHaveLength(10);
    const pairing = await createTelegramPairing(admin);
    const stored = await db.telegramPairingCode.findFirst({ where: { userId: admin.id } });
    expect(stored?.codeHash).toBe(hashPairingCode(pairing.code));
    expect(stored?.codeHash).not.toBe(pairing.code);

    const linked = await handleTelegramUpdate(privateUpdate(`/start ${pairing.code}`));
    expect(linked[0]?.text).toBe("Hesap bağlandı.");
    const again = await handleTelegramUpdate(privateUpdate(`/start ${pairing.code}`));
    expect(again[0]?.text).toBe("Eşleştirme kodu geçersiz.");
    expect(await db.telegramLink.count({ where: { userId: admin.id, revokedAt: null } })).toBe(1);

    const menu = await db.mealMenu.create({
      data: {
        date: dateOnly("2098-06-02"),
        note: "faz10",
        published: true,
        items: { create: [{ name: "Faz10 Tabak", sortOrder: 0 }] },
      },
      include: { items: true },
    });
    await db.mealOrder.create({
      data: { userId: employee.id, menuId: menu.id, itemId: menu.items[0].id, status: "RECEIVED" },
    });
    const meal = await loadMealCloseNotice(db, "2098-06-02");
    expect(meal.text).toBe("2098-06-02 yemek kapanışı\nFaz10 Tabak: 1\nToplam: 1");
    const mealCalls = [];
    const mealDelivery = await dispatchTelegramMessage({
      ...meal,
      dedupeKey: "faz10-meal",
      chatId: String(adminTelegramId),
      delivery: "live",
      transport: async (body) => {
        mealCalls.push(body.text);
      },
    });
    expect(mealDelivery.status).toBe("sent");
    const mealDuplicate = await dispatchTelegramMessage({
      ...meal,
      dedupeKey: "faz10-meal",
      chatId: String(adminTelegramId),
      delivery: "live",
      transport: async () => {
        mealCalls.push("ikinci");
      },
    });
    expect(mealDuplicate.status).toBe("duplicate");
    expect(mealCalls).toEqual([meal.text]);
    const skipped = await dispatchTelegramMessage({
      ...meal,
      dedupeKey: "faz10-meal-off",
      chatId: String(adminTelegramId),
      delivery: "off",
      transport: async () => {
        mealCalls.push("kapali");
      },
    });
    expect(skipped.status).toBe("skipped");
    expect(mealCalls).toHaveLength(1);
    expect(await db.mealOrder.count({ where: { id: (await db.mealOrder.findFirst({ where: { userId: employee.id } })).id, status: "RECEIVED" } })).toBe(1);

    const unreachable = await dispatchTelegramMessage({
      dedupeKey: "faz10-down",
      kind: "meal.close",
      chatId: String(adminTelegramId),
      text: meal.text,
      delivery: "live",
      transport: async () => {
        throw new Error("https://api.telegram.org/bot123456789:AAHexampletokenvalue1234567890/sendMessage");
      },
    });
    expect(unreachable.status).toBe("failed");
    expect(unreachable.error).not.toContain("AAHexample");
    const recovered = await dispatchTelegramMessage({
      dedupeKey: "faz10-down",
      kind: "meal.close",
      chatId: String(adminTelegramId),
      text: meal.text,
      delivery: "live",
      transport: async () => undefined,
    });
    expect(recovered.status).toBe("sent");
    expect(await db.telegramDispatch.count({ where: { dedupeKey: "faz10-down" } })).toBe(1);
    expect(meal.text).toContain("Toplam: 1");

    const approvedLeave = await db.leaveRequest.create({
      data: {
        userId: employee.id,
        type: "EXCUSE",
        duration: "FULL_DAY",
        startDate: dateOnly("2098-06-10"),
        endDate: dateOnly("2098-06-10"),
        startsAt: leaveStart,
        endsAt: leaveEnd,
        dayCount: "1.00",
        status: "PENDING",
      },
    });
    const rejectedLeave = await db.leaveRequest.create({
      data: {
        userId: otherRow.id,
        type: "EXCUSE",
        duration: "FULL_DAY",
        startDate: dateOnly("2098-06-11"),
        endDate: dateOnly("2098-06-11"),
        startsAt: leaveStart,
        endsAt: leaveEnd,
        dayCount: "1.00",
        status: "PENDING",
      },
    });
    const listed = await handleTelegramUpdate(privateUpdate("/izin"));
    expect(listed[0]?.text).toContain("Faz10 Calisan");
    expect(listed[0]?.buttons?.some((row) => row.some((button) => button.data === leaveCallback("APPROVED", approvedLeave.id)))).toBe(true);
    expect(await db.leaveRequest.findUnique({ where: { id: approvedLeave.id } })).toMatchObject({ status: "PENDING" });
    expect(await db.leaveAudit.count({ where: { requestId: approvedLeave.id } })).toBe(0);

    expect((await handleTelegramUpdate(privateUpdate("/izin", 7100001111)))[0]?.text).toBe("Bu Telegram hesabı yönetici olarak bağlı değil.");
    expect((await handleTelegramUpdate({ message: { text: "/izin", from: { id: adminTelegramId }, chat: { id: -100 } } }))).toEqual([]);

    const approved = await handleTelegramUpdate(decisionUpdate(leaveCallback("APPROVED", approvedLeave.id)));
    expect(approved[0]?.text).toBe("İzin talebi onaylandı.");
    const approvalAudit = await db.leaveAudit.findFirst({ where: { requestId: approvedLeave.id, action: "APPROVED" } });
    expect(approvalAudit?.note).toBe("Telegram üzerinden onaylandı.");
    expect(approvalAudit?.actorId).toBe(admin.id);
    const repeated = await handleTelegramUpdate(decisionUpdate(leaveCallback("APPROVED", approvedLeave.id)));
    expect(repeated[0]?.text).toBe("Yalnızca bekleyen talepler incelenebilir.");
    expect(await db.leaveAudit.count({ where: { requestId: approvedLeave.id, action: "APPROVED" } })).toBe(1);

    await db.telegramLink.create({
      data: { userId: employee.id, telegramUserId: String(employeeTelegramId), chatId: String(employeeTelegramId) },
    });
    const denied = await handleTelegramUpdate(decisionUpdate(leaveCallback("REJECTED", rejectedLeave.id), employeeTelegramId));
    expect(denied[0]?.text).toBe("Bu Telegram hesabı yönetici olarak bağlı değil.");
    expect(await db.leaveRequest.findUnique({ where: { id: rejectedLeave.id } })).toMatchObject({ status: "PENDING" });

    const rejected = await handleTelegramUpdate(decisionUpdate(leaveCallback("REJECTED", rejectedLeave.id)));
    expect(rejected[0]?.text).toBe("İzin talebi reddedildi.");
    expect(await db.leaveAudit.findFirst({ where: { requestId: rejectedLeave.id, action: "REJECTED" } })).toMatchObject({
      note: "Telegram üzerinden reddedildi.",
      actorId: admin.id,
    });

    const invoice = await db.invoiceReview.create({
      data: {
        status: "PENDING",
        contentHash: `faz10-${randomUUID()}`,
        storageKey: `faz10-${randomUUID()}`,
        fileName: "faz10-fatura.pdf",
        vendor: "Faz10 Satici",
        number: "FW-10",
        sizeBytes: 8,
        documentType: "INVOICE",
        aiSnapshot: {},
      },
    });
    const statement = await db.invoiceReview.create({
      data: {
        status: "PENDING",
        contentHash: `faz10-${randomUUID()}`,
        storageKey: `faz10-${randomUUID()}`,
        fileName: "faz10-ekstre.pdf",
        sizeBytes: 8,
        documentType: "STATEMENT",
        aiSnapshot: {},
      },
    });
    await db.technologySubscription.create({
      data: {
        name: "Faz10 Yakin",
        vendor: "Faz10",
        kind: "SOFTWARE",
        amount: "10.00",
        currency: "TRY",
        billingCycle: "MONTHLY",
        renewsOn: dateOnly("2098-06-15"),
        status: "ACTIVE",
        active: true,
      },
    });
    await db.technologySubscription.create({
      data: {
        name: "Faz10 Uzak",
        vendor: "Faz10",
        kind: "SOFTWARE",
        amount: "10.00",
        currency: "USD",
        billingCycle: "YEARLY",
        renewsOn: dateOnly("2099-06-01"),
        status: "ACTIVE",
        active: true,
      },
    });
    const job = await db.automationJob.findUnique({ where: { key: "invoice.daily" } });
    if (!job) {
      throw new Error("Fatura tarama görevi yok.");
    }
    const older = job
      ? await db.automationRun.create({
          data: {
            jobId: job.id,
            windowKey: `faz10-old-${randomUUID()}`,
            attempt: 1,
            state: "FAILED",
            startedAt: new Date("2098-05-01T09:00:00+03:00"),
            finishedAt: new Date("2098-05-01T09:01:00+03:00"),
            error: "Faz10 eski",
            summary: "Faz10 eski",
          },
        })
      : null;
    const latest = job
      ? await db.automationRun.create({
          data: {
            jobId: job.id,
            windowKey: `faz10-new-${randomUUID()}`,
            attempt: 1,
            state: "FAILED",
            startedAt: new Date("2098-06-01T09:00:00+03:00"),
            finishedAt: new Date("2098-06-01T09:01:00+03:00"),
            error: "Faz10 yeni",
            summary: "Faz10 yeni",
          },
        })
      : null;
    const notices = await loadOperationalNotices(db, now);
    expect(notices.find((notice) => notice.dedupeKey === `invoice.review:${invoice.id}`)?.text).toBe("Yeni fatura incelemesi\nFaz10 Satici · FW-10");
    expect(notices.find((notice) => notice.text.includes("Faz10 Yakin"))?.text).toBe("Yaklaşan abonelik\nFaz10 Yakin · 2098-06-15");
    expect(notices.some((notice) => notice.dedupeKey === `invoice.review:${statement.id}`)).toBe(false);
    expect(notices.some((notice) => notice.text.includes("Faz10 Yakin") && notice.text.includes("2098-06-15"))).toBe(true);
    expect(notices.some((notice) => notice.text.includes("Faz10 Uzak"))).toBe(false);
    if (latest && older) {
      const failure = notices.find((notice) => notice.dedupeKey === `automation.failed:${latest.id}`);
      expect(failure?.text).toContain("Otomasyon hatası");
      expect(failure?.text).toContain(job.name);
      expect(failure?.text).toContain("Faz10 yeni");
      expect(notices.some((notice) => notice.dedupeKey === `automation.failed:${older.id}`)).toBe(false);
    }
    expect(await db.invoiceReview.findUnique({ where: { id: invoice.id } })).toMatchObject({ status: "PENDING" });
    const fixtureNotices = notices.filter((notice) => notice.text.includes("Faz10") || notice.dedupeKey === `invoice.review:${invoice.id}` || (latest && notice.dedupeKey === `automation.failed:${latest.id}`));
    const calls = [];
    const first = await dispatchTelegramBatch(fixtureNotices, {
      chatId: String(adminTelegramId),
      delivery: "live",
      transport: async (body) => {
        calls.push(body.text);
      },
    });
    const second = await dispatchTelegramBatch(fixtureNotices, {
      chatId: String(adminTelegramId),
      delivery: "live",
      transport: async () => {
        calls.push("mukerrer");
      },
    });
    expect(first.sent).toBe(fixtureNotices.length);
    expect(second.duplicate).toBe(fixtureNotices.length);
    expect(calls).toHaveLength(fixtureNotices.length);
    expect(await db.technologySubscription.count({ where: { name: { in: ["Cursor Pro", "Rive"] } } })).toBe(namedBefore);
    expect(await db.invoiceReview.count({ where: { fileName: { not: { startsWith: "faz10-" } } } })).toBe(realReviewsBefore);
    expect(await db.expense.count()).toBe(0);
    expect(await db.invoice.count()).toBe(1);
  });

  it("eşleştirme kodu on dakika sürer, süresi dolunca ve ikinci kez kapanır", async () => {
    await removeFixtures();
    const db = getPrisma();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!b2`);
    const adminRow = await db.user.create({
      data: { email: fixtureEmail(), name: "Faz10 Sure", role: "ADMIN", passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: { email: fixtureEmail(), name: "Faz10 Yetkisiz", role: "EMPLOYEE", passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id);
    const now = new Date("2098-04-01T09:00:00+03:00");
    const telegramId = 7200000000 + Math.floor(Math.random() * 100000);
    const employeePairing = await createTelegramPairing(employeeRow, now);
    expect(employeePairing.code).toHaveLength(10);
    const expired = await createTelegramPairing(adminRow, now);
    expect(expired.expiresAt.getTime() - now.getTime()).toBe(10 * 60 * 1000);
    await expectCode(() => consumeTelegramPairing({
      code: expired.code,
      telegramUserId: String(telegramId),
      chatId: String(telegramId),
      now: new Date(expired.expiresAt.getTime()),
    }), "VALIDATION");
    expect(await db.telegramLink.count({ where: { userId: adminRow.id } })).toBe(0);
    const fresh = await createTelegramPairing(adminRow, now);
    const linked = await consumeTelegramPairing({
      code: fresh.code,
      telegramUserId: String(telegramId),
      chatId: String(telegramId),
      now: new Date(now.getTime() + 9 * 60 * 1000),
    });
    expect(linked.userId).toBe(adminRow.id);
    await expectCode(() => consumeTelegramPairing({
      code: fresh.code,
      telegramUserId: String(telegramId),
      chatId: String(telegramId),
      now: new Date(now.getTime() + 9 * 60 * 1000),
    }), "VALIDATION");
    const stranger = await handleTelegramUpdate(privateUpdate("/start YANLIS1234", telegramId + 1));
    expect(stranger[0]?.text).toBe("Eşleştirme kodu geçersiz.");
    expect(await db.telegramLink.count({ where: { telegramUserId: String(telegramId + 1) } })).toBe(0);
  });

  it("aynı Telegram güncellemesini ikinci kez işlemez", async () => {
    await removeFixtures();
    const db = getPrisma();
    const passwordHash = await hashPassword(`Test-${randomBytes(6).toString("hex")}!c3`);
    const adminRow = await db.user.create({
      data: { email: fixtureEmail(), name: "Faz10 Tekrar", role: "ADMIN", passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });
    const employeeRow = await db.user.create({
      data: { email: fixtureEmail(), name: "Faz10 Personel", role: "EMPLOYEE", passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });
    fixtureIds.push(adminRow.id, employeeRow.id);
    const telegramId = 7300000000 + Math.floor(Math.random() * 100000);
    const pairing = await createTelegramPairing(adminRow);
    await consumeTelegramPairing({
      code: pairing.code,
      telegramUserId: String(telegramId),
      chatId: String(telegramId),
    });
    const leave = await db.leaveRequest.create({
      data: {
        userId: employeeRow.id,
        type: "EXCUSE",
        duration: "FULL_DAY",
        startDate: dateOnly("2098-07-01"),
        endDate: dateOnly("2098-07-01"),
        startsAt: new Date("2098-07-01T09:00:00+03:00"),
        endsAt: new Date("2098-07-01T17:00:00+03:00"),
        dayCount: "1.00",
        status: "PENDING",
      },
    });
    const otherLeave = await db.leaveRequest.create({
      data: {
        userId: employeeRow.id,
        type: "EXCUSE",
        duration: "FULL_DAY",
        startDate: dateOnly("2098-07-02"),
        endDate: dateOnly("2098-07-02"),
        startsAt: new Date("2098-07-02T09:00:00+03:00"),
        endsAt: new Date("2098-07-02T17:00:00+03:00"),
        dayCount: "1.00",
        status: "PENDING",
      },
    });
    const secret = "faz10-webhook-secret-value";
    const env = { TELEGRAM_WEBHOOK_SECRET: secret, TELEGRAM_DELIVERY: "off" };
    const updateId = 910000000000 + Math.floor(Math.random() * 100000);
    receiptIds.push(String(updateId));
    const body = {
      update_id: updateId,
      callback_query: {
        id: "faz10-cb",
        data: leaveCallback("APPROVED", leave.id),
        from: { id: telegramId },
        message: { chat: { id: telegramId } },
      },
    };
    const denied = await receiveTelegramWebhook(new Request("http://127.0.0.1/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "yanlis-sirr" },
      body: JSON.stringify(body),
    }), env);
    expect(denied.status).toBe(401);
    expect(await db.leaveRequest.findUnique({ where: { id: leave.id } })).toMatchObject({ status: "PENDING" });
    const call = () => receiveTelegramWebhook(new Request("http://127.0.0.1/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(body),
    }), env);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect(await db.leaveAudit.count({ where: { requestId: leave.id, action: "APPROVED" } })).toBe(1);
    expect(await db.leaveRequest.findUnique({ where: { id: leave.id } })).toMatchObject({ status: "APPROVED" });
    const outsider = 7400000000 + Math.floor(Math.random() * 100000);
    const blockedId = updateId + 1;
    receiptIds.push(String(blockedId));
    const blocked = await receiveTelegramWebhook(new Request("http://127.0.0.1/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify({
        update_id: blockedId,
        callback_query: {
          id: "faz10-cb-2",
          data: leaveCallback("REJECTED", otherLeave.id),
          from: { id: outsider },
          message: { chat: { id: outsider } },
        },
      }),
    }), env);
    expect(blocked.status).toBe(200);
    expect(await db.leaveRequest.findUnique({ where: { id: leave.id } })).toMatchObject({ status: "APPROVED" });
    expect(await db.leaveRequest.findUnique({ where: { id: otherLeave.id } })).toMatchObject({ status: "PENDING" });
    expect(await db.leaveAudit.count({ where: { requestId: otherLeave.id } })).toBe(0);
  });
});
