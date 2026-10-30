
import { dateOnly } from "@/server/dates";
import { googleConnectionReport } from "@/server/finance/google";
import { readFinanceDocument } from "@/server/finance/readDocument";
import { accessTokenFor } from "@/server/google/account";

import { createGmailApi } from "@/server/google/gmail";
import { importGmailInvoices, InvoiceScanRetryError, invoiceSummary } from "@/server/google/invoices";
import { analyzeGmail, mailSummary } from "@/server/google/mailbox";
import { GoogleOAuthError } from "@/server/google/oauth";
import { DEFAULT_MEAL_WEEKDAYS, istanbulClock, mealDispatchDecision, MEAL_SETTINGS_ID } from "@/server/meals/schedule";
import { mealOrderTotals } from "@/server/meals/totals";
import { pushInvoiceProblem, pushInvoiceScan } from "@/server/telegram/invoicePush";
import { pushPendingLeaveApprovals } from "@/server/telegram/leaveDigest";
import { pushMealRoster, rosterPeople } from "@/server/telegram/mealPush";
import { pushRenewalReminders } from "@/server/telegram/renewals";
import { writeRenewalNotices } from "@/server/technology/notices";

 

















function waitingMail() {
  return {
    connected: false,
    readAt: null,
    account: null,
    important: [],
    pendingReplies: [],
    tasks: [],
    alreadyProcessed: 0,
    outbound: "APPROVAL_REQUIRED",
  };
}

function waitingInvoice() {
  return {
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
    skipped: 0,
    outgoing: 0,
    retryable: 0,
    statements: 0,
    driveUploaded: false,
    archivePattern: googleConnectionReport().archivePattern,
  };
}

async function scanActorId(db) {
  const account = await db.googleAccount.findUnique({
    where: { id: "default" },
    select: { connectedById: true },
  });
  if (account?.connectedById) {
    const linked = await db.user.findFirst({
      where: { id: account.connectedById, role: "ADMIN", active: true, approver: true },
      select: { id: true },
    });
    if (linked) {
      return linked.id;
    }
  }
  const admin = await db.user.findFirst({
    where: { role: "ADMIN", active: true, approver: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id;
}

async function connectedAccount(db) {
  return db.googleAccount.findUnique({ where: { id: "default" } });
}

export function classifyAttachment(fileName, text) {
  const literals = text
    .split("\n")
    .map((line) => `(${line.replace(/[()]/g, "")})`)
    .join("\n");
  const reading = readFinanceDocument(Buffer.from(`%PDF-1.4\n${literals}\n%%EOF`), fileName);
  if (reading.kind === "INVOICE") {
    return "INVOICE";
  }
  if (reading.kind === "RECEIPT") {
    return "RECEIPT";
  }
  return "REJECT";
}

async function saveScanNotice(db, body) {
  await db.panelNotice.deleteMany({ where: { dedupeKey: "invoice.scan:latest" } });
  await savePanelNotice(db, {
    dedupeKey: "invoice.scan:latest",
    title: "Fatura taraması",
    body,
  });
}

async function savePanelNotice(
  db,
  notice,
) {
  try {
    await db.panelNotice.create({
      data: {
        dedupeKey: notice.dedupeKey,
        title: notice.title,
        body: notice.body,
        channel: "PANEL",
        delivered: false,
      },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}

function disconnectedSummary() {
  const report = googleConnectionReport();
  const missing = report.missing.length > 0 ? ` Eksik: ${report.missing.join(", ")}.` : "";
  return `Gmail bağlantısı yok. Posta okunmadı.${missing} Gönderme ve silme çalıştırılmaz.`;
}

export async function runGmailAnalysis(
  db,
  runtime = {},
) {
  const account = await connectedAccount(db);
  if (!account || account.status !== "CONNECTED" || (!runtime.gmail && !googleConnectionReport().credentialsConfigured)) {
    return {
      state: "WAITING_CONNECTION",
      summary: disconnectedSummary(),
      report: waitingMail(),
    };
  }
  try {
    const api = runtime.gmail ?? (await liveGmail(db, runtime.fetchImpl));
    if (!api) {
      return {
        state: "WAITING_CONNECTION",
        summary: "Gmail bağlantısı yok. Posta okunmadı. Gönderme ve silme çalıştırılmaz.",
        report: waitingMail(),
      };
    }
    const report = await analyzeGmail(db, api, account.email);
    return { state: "SUCCEEDED", summary: mailSummary(report), report };
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.kind === "invalid_grant") {
      await db.googleAccount.update({
        where: { id: "default" },
        data: { accessTokenCipher: null, accessTokenExpiresAt: null },
      });
    }
    throw error;
  }
}

async function liveGmail(db, fetchImpl = fetch) {
  const access = await accessTokenFor(db, fetchImpl);
  if (!access) {
    return null;
  }
  return createGmailApi(access.token, fetchImpl);
}

function invoiceFailureText(error) {
  if (error instanceof InvoiceScanRetryError) {
    return error.message;
  }
  if (error instanceof GoogleOAuthError) {
    return "Google erişimi yenilenemedi. Posta değiştirilmedi. Yeniden denenecek.";
  }
  if (error instanceof Error && (error.message === "Gmail yanıt vermedi." || /^Gmail isteği başarısız \(\d+\)$/.test(error.message))) {
    return `${error.message} Posta değiştirilmedi. Yeniden denenecek.`;
  }
  return "Fatura taraması tamamlanamadı. Posta değiştirilmedi. Yeniden denenecek.";
}

async function invoiceAlertDue(db) {
  const running = await db.automationJob.findFirst({
    where: {
      key: "invoice.daily",
      lockToken: { not: null },
    },
    select: { retryCount: true, maxRetries: true },
  });
  if (!running) {
    return true;
  }
  return running.retryCount + 1 >= running.maxRetries;
}

export async function runInvoiceScan(db, runtime = {}) {
  const account = await connectedAccount(db);
  const injected = Boolean(runtime.gmail);
  if (!account || account.status !== "CONNECTED" || (!injected && !googleConnectionReport().credentialsConfigured)) {
    const report = waitingInvoice();
    return {
      state: "WAITING_CONNECTION",
      summary: `${invoiceSummary(report)} ${disconnectedSummary()}`,
      report,
    };
  }
  try {
    let gmail = runtime.gmail;
    if (!gmail) {
      const access = await accessTokenFor(db, runtime.fetchImpl);
      if (!access) {
        const report = waitingInvoice();
        return {
          state: "WAITING_CONNECTION",
          summary: `${invoiceSummary(report)} Posta okunmadı ve dosya Drive'a yüklenmedi.`,
          report,
        };
      }
      gmail = createGmailApi(access.token, runtime.fetchImpl);
    }
    const previous = await db.automationJob.findFirst({
      where: {
        key: "invoice.daily",
        lastSuccessAt: { not: null },
      },
      orderBy: { lastSuccessAt: "desc" },
      select: { lastSuccessAt: true },
    });
    const report = await importGmailInvoices(db, gmail, {
      fetchImpl: runtime.fetchImpl,
      commitActorId: await scanActorId(db),
      since: previous?.lastSuccessAt ?? undefined,
    });
    await saveScanNotice(db, invoiceSummary(report));
    await pushInvoiceScan(db, report);
    return { state: "SUCCEEDED", summary: invoiceSummary(report), report };
  } catch (error) {
    const detail = invoiceFailureText(error);
    if (error instanceof InvoiceScanRetryError) {
      await saveScanNotice(db, error.message);
      const partial = error.report;
      if (partial && (partial.processed.length > 0 || partial.needsApproval.length > 0)) {
        await pushInvoiceScan(db, { ...partial, errors: [], retryable: 0 });
      }
    }
    if (await invoiceAlertDue(db)) {
      await pushInvoiceProblem(db, detail);
    }
    if (error instanceof GoogleOAuthError && error.kind === "invalid_grant") {
      await db.googleAccount.update({
        where: { id: "default" },
        data: { accessTokenCipher: null, accessTokenExpiresAt: null },
      });
    }
    throw error;
  }
}

async function dayRoster(db, date) {
  const menu = await db.mealMenu.findUnique({
    where: { date: dateOnly(date) },
    include: {
      orders: {
        where: { status: { not: "CANCELLED" } },
        include: {
          user: { select: { name: true } },
          item: { select: { name: true } },
          soupItem: { select: { name: true } },
          sideItem: { select: { name: true } },
          dessertItem: { select: { name: true } },
        },
      },
      guestOrders: {
        include: {
          item: { select: { name: true } },
          soupItem: { select: { name: true } },
          sideItem: { select: { name: true } },
          dessertItem: { select: { name: true } },
        },
      },
    },
  });
  return {
    menu,
    roster: rosterPeople(menu?.orders ?? [], menu?.guestOrders ?? []),
  };
}

export async function runMealClose(db, now, context = {}) {
  const settings = await db.mealSettings.findUnique({
    where: { id: MEAL_SETTINGS_ID },
    select: { weekdays: true },
  });
  const decision = mealDispatchDecision(now, context.scheduledFor, settings?.weekdays ?? DEFAULT_MEAL_WEEKDAYS);
  if (!decision.send) {
    return { state: "SUCCEEDED", summary: decision.summary };
  }
  const { menu, roster } = await dayRoster(db, decision.date);
  const totals = mealOrderTotals(menu?.orders ?? []);
  const lines = totals.rows.map((row) => `${row.name}: ${row.count}`);
  if (totals.absent > 0) {
    lines.push(`Ofiste olmayan: ${totals.absent}`);
  }
  const body = menu
    ? lines.length > 0
      ? `Sipariş penceresi kapandı. ${lines.join(", ")}.`
      : "Sipariş penceresi kapandı. İptal edilmeyen sipariş yok."
    : "Bugün yayımlanmış menü yok. Kapanış kaydı oluşturuldu.";
  await savePanelNotice(db, {
    dedupeKey: `ops.meal-close:${decision.date}`,
    title: "Yemek siparişi kapandı",
    body,
  });
  return { state: "SUCCEEDED", summary: `${body} Liste 11:05'te Telegram'a gider. Sipariş: ${roster.length}.` };
}

export async function runMealRoster(db, now, context = {}) {
  const settings = await db.mealSettings.findUnique({
    where: { id: MEAL_SETTINGS_ID },
    select: { catererPhone: true, weekdays: true },
  });
  const decision = mealDispatchDecision(now, context.scheduledFor, settings?.weekdays ?? DEFAULT_MEAL_WEEKDAYS);
  if (!decision.send) {
    return { state: "SUCCEEDED", summary: decision.summary };
  }
  const { roster } = await dayRoster(db, decision.date);
  const sent = await pushMealRoster(db, decision.date, roster, settings?.catererPhone);
  const body = sent > 0
    ? "Günün yemek listesi Telegram'a iletildi."
    : "Günün yemek listesi Telegram'a iletilemedi.";
  await savePanelNotice(db, {
    dedupeKey: `ops.meal-roster:${decision.date}`,
    title: "Yemekçi listesi",
    body,
  });
  return { state: "SUCCEEDED", summary: `${body} Telegram: ${sent}.` };
}

export async function runLeavePending(db, now) {
  const clock = istanbulClock(now);
  const pending = await db.leaveRequest.findMany({
    where: { status: "PENDING" },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: 30,
  });
  const sent = await pushPendingLeaveApprovals(db, clock.date);
  const body =
    pending.length > 0
      ? `Bekleyen izin: ${pending.length}. ${pending.map((request) => request.user.name).join(", ")}. Telegram: ${sent}.`
      : "Bekleyen izin talebi yok.";
  await savePanelNotice(db, {
    dedupeKey: `ops.leave-pending:${clock.date}`,
    title: "Bekleyen izin talepleri",
    body,
  });
  return { state: "SUCCEEDED", summary: body };
}

export async function runRenewalCheck(db, now) {
  const clock = istanbulClock(now);
  const created = await writeRenewalNotices(db, clock.date);
  const sent = await pushRenewalReminders(db, clock.date);
  const body = `Yenileme kontrolü tamamlandı. Yeni bildirim: ${created}. Telegram hatırlatması: ${sent}.`;
  await savePanelNotice(db, {
    dedupeKey: `ops.renewals:${clock.date}`,
    title: "Teknoloji yenileme kontrolü",
    body,
  });
  return { state: "SUCCEEDED", summary: body };
}

async function skipMailSummary() {
  return { state: "SUCCEEDED", summary: "Posta özeti kapalı. Yalnızca faturalar taranır." };
}

export const JOB_HANDLERS = {
  "gmail.morning": skipMailSummary,
  "gmail.evening": skipMailSummary,
  "invoice.daily": (db) => runInvoiceScan(db),
  "ops.meal-close": (db, now) => runMealClose(db, now),
  "ops.meal-roster": (db, now) => runMealRoster(db, now),
  "ops.leave-pending": (db, now) => runLeavePending(db, now),
  "ops.renewals": (db, now) => runRenewalCheck(db, now),
};
