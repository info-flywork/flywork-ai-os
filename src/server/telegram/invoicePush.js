
import { istanbulToday } from "@/server/dates";

import {
  formatInvoiceProcessed,
  formatInvoiceQuestion,
  invoiceDecisionButtons,
} from "@/server/telegram/messages";
import { deliverTelegram, liveTelegramTransport } from "@/server/telegram/send";



async function adminLinks(db) {
  return db.telegramLink.findMany({
    where: { revokedAt: null, user: { role: "ADMIN", active: true, approver: true } },
    select: { userId: true, chatId: true },
  });
}

async function sendEach(
  db,
  messages,
) {
  const admins = await adminLinks(db);
  if (admins.length === 0) {
    return;
  }
  const channel = liveTelegramTransport();
  if (channel.delivery !== "live" || !channel.transport) {
    return;
  }
  for (const message of messages) {
    for (const admin of admins) {
      await deliverTelegram(db, {
        dedupeKey: `${message.dedupeKey}:${admin.userId}`,
        kind: message.kind,
        chatId: admin.chatId,
        text: message.text,
        buttons: message.buttons,
        delivery: channel.delivery,
        transport: channel.transport,
      });
    }
  }
}

export async function pushInvoiceScan(db, report) {
  const messages = [
    ...report.processed.map((item) => ({
      dedupeKey: `invoice.processed:${item.reviewId}`,
      kind: "invoice.processed",
      text: formatInvoiceProcessed(item),
    })),
    ...report.needsApproval.map((item) => ({
      dedupeKey: `invoice.ask:${item.reviewId}`,
      kind: "invoice.ask",
      text: formatInvoiceQuestion(item),
      buttons: invoiceDecisionButtons(item.reviewId),
    })),
  ];
  if (report.retryable > 0 || report.errors.length > 0) {
    messages.push({
      dedupeKey: `invoice.problem:${report.scannedAt ?? istanbulToday()}:read`,
      kind: "invoice.problem",
      text: `Fatura taramasında sorun var\n${report.errors[0] ?? "Belge okunamadı. Yeniden denenecek."}`,
    });
  }
  await sendEach(db, messages);
}

export async function pushInvoiceProblem(db, text) {
  const today = istanbulToday();
  await sendEach(db, [{
    dedupeKey: `invoice.problem:${today}:${text.slice(0, 80)}`,
    kind: "invoice.problem",
    text: `Fatura taramasında sorun var\n${text.slice(0, 300)}`,
  }]);
}
