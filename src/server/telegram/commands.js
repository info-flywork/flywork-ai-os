import "server-only";

import { can } from "@/server/auth/permissions";
import { dateOnly, istanbulToday, toIsoDate } from "@/server/dates";
import { MEAL_SETTINGS_ID, catererWhatsappLink, formatMealRoster } from "@/server/meals/schedule";
import { rosterPeople } from "@/server/telegram/mealPush";
import { withDatabase } from "@/server/db";
import { toPublicError } from "@/server/errors";
import { reviewLeaveRequest } from "@/server/services/leave";
import { addWorkComment } from "@/server/services/work";
import { downloadTelegramFile } from "@/server/telegram/client";
import { telegramBotToken } from "@/server/telegram/config";
import { inspectWorkImage } from "@/server/work/images";
import { confirmedInvoiceDraft } from "@/server/finance/reviewRules";
import { decideInvoiceReview } from "@/server/services/invoiceReview";
import { pushRenewalReminders } from "@/server/telegram/renewals";
import { beginTelegramEmailLink, consumeTelegramPairing, decideTelegramEmailLink, submitTelegramEmail } from "@/server/telegram/pairing";
import {
  emailLinkCallback,
  formatInvoiceProcessed,
  formatPendingLeaves,
  formatWorkReplyPrompt,
  leaveDecisionButtons,
  parseEmailLinkCallback,
  parseInvoiceCallback,
  parseInvoiceReply,
  parseLeaveCallback,
  parseTelegramCommand,
  parseWorkReplyCallback,

} from "@/server/telegram/messages";

 














function plainMoney(value) {
  if (!value) {
    return "";
  }
  const number = Number(value.toString());
  if (!Number.isFinite(number)) {
    return "";
  }
  return number.toFixed(2);
}

function reply(input, text, buttons) {
  return {
    chatId: input.chatId,
    text,
    buttons,
    callbackQueryId: input.callbackQueryId,
  };
}

function privateIds(from, chat) {
  if (!from || !chat || typeof from !== "object" || typeof chat !== "object") {
    return null;
  }
  const fromId = "id" in from ? from.id : undefined;
  const chatId = "id" in chat ? chat.id : undefined;
  if (typeof fromId !== "number" || typeof chatId !== "number" || !Number.isInteger(fromId) || !Number.isInteger(chatId)) {
    return null;
  }
  if (fromId !== chatId) {
    return null;
  }
  return { telegramUserId: String(fromId), chatId: String(chatId) };
}

function messagePhotoId(message) {
  if ("photo" in message && Array.isArray(message.photo) && message.photo.length > 0) {
    const last = message.photo[message.photo.length - 1];
    if (last && typeof last === "object" && "file_id" in last && typeof last.file_id === "string") {
      return last.file_id;
    }
  }
  if ("document" in message && message.document && typeof message.document === "object") {
    const mime = "mime_type" in message.document && typeof message.document.mime_type === "string" ? message.document.mime_type : "";
    const fileId = "file_id" in message.document && typeof message.document.file_id === "string" ? message.document.file_id : "";
    if ((mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") && fileId) return fileId;
  }
  return "";
}

export function readTelegramUpdate(update) {
  if (!update || typeof update !== "object") {
    return null;
  }
  if ("message" in update && update.message && typeof update.message === "object") {
    const message = update.message;
    const ids = privateIds("from" in message ? message.from : undefined, "chat" in message ? message.chat : undefined);
    const text = "text" in message && typeof message.text === "string" ? message.text : "";
    const caption = "caption" in message && typeof message.caption === "string" ? message.caption : "";
    const spoken = text || caption;
    const photoFileId = messagePhotoId(message);
    if (!ids || spoken.length > 4096 || (spoken.length === 0 && !photoFileId) || photoFileId.length > 256) {
      return null;
    }
    return { ...ids, text: spoken, photoFileId };
  }
  if ("callback_query" in update && update.callback_query && typeof update.callback_query === "object") {
    const query = update.callback_query;
    const message = "message" in query && query.message && typeof query.message === "object" ? query.message : null;
    const ids = privateIds("from" in query ? query.from : undefined, message && "chat" in message ? message.chat : undefined);
    const data = "data" in query && typeof query.data === "string" ? query.data : "";
    const callbackQueryId = "id" in query && typeof query.id === "string" ? query.id : "";
    if (!ids || !callbackQueryId || data.length === 0 || data.length > 64) {
      return null;
    }
    return { ...ids, data, callbackQueryId };
  }
  return null;
}

const WORK_REPLY_MS = 30 * 60 * 1000;

async function linkedWorker(telegramUserId, chatId) {
  return withDatabase(async (db) => {
    const link = await db.telegramLink.findUnique({
      where: { telegramUserId },
      include: { user: { select: { id: true, role: true, email: true, name: true, active: true, approver: true, mealOnly: true } } },
    });
    if (!link || link.revokedAt || link.chatId !== chatId || !link.user.active || link.user.mealOnly || !can(link.user.role, "task:write")) {
      return null;
    }
    return link.user;
  });
}

async function beginWorkReply(telegramUserId, taskId) {
  return withDatabase(async (db) => {
    const task = await db.workTask.findUnique({ where: { id: taskId }, select: { id: true, title: true } });
    if (!task) {
      return null;
    }
    const expiresAt = new Date(Date.now() + WORK_REPLY_MS);
    await db.telegramWorkReply.upsert({
      where: { telegramUserId },
      create: { telegramUserId, taskId, expiresAt },
      update: { taskId, expiresAt },
    });
    const people = await db.user.findMany({
      where: { active: true, mealOnly: false },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 20,
    });
    return { title: task.title, names: people.map((person) => person.name) };
  });
}

async function pendingWorkReply(telegramUserId) {
  return withDatabase(async (db) => {
    const pending = await db.telegramWorkReply.findUnique({ where: { telegramUserId } });
    if (!pending) {
      return null;
    }
    if (pending.expiresAt <= new Date()) {
      await db.telegramWorkReply.delete({ where: { telegramUserId } });
      return "expired";
    }
    return pending;
  });
}

async function clearWorkReply(telegramUserId) {
  await withDatabase((db) => db.telegramWorkReply.deleteMany({ where: { telegramUserId } }));
}

async function linkedAdmin(telegramUserId, chatId) {
  return withDatabase(async (db) => {
    const link = await db.telegramLink.findUnique({
      where: { telegramUserId },
      include: { user: { select: { id: true, role: true, email: true, name: true, active: true, approver: true } } },
    });
    if (!link || link.revokedAt || link.chatId !== chatId || !link.user.active || !link.user.approver || !can(link.user.role, "leaveRequest:review")) {
      return null;
    }
    return link.user;
  });
}

async function pendingLeaves() {
  return withDatabase(async (db) => {
    const rows = await db.leaveRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { startDate: "asc" },
      take: 20,
      select: {
        id: true,
        type: true,
        startDate: true,
        endDate: true,
        dayCount: true,
        user: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      employeeName: row.user.name,
      type: row.type,
      startDate: toIsoDate(row.startDate),
      endDate: toIsoDate(row.endDate),
      dayCount: row.dayCount.toFixed(2),
    }));
  });
}

function one(message) {
  return [message];
}

const invoiceReviewSelect = {
  id: true,
  status: true,
  documentType: true,
  vendor: true,
  number: true,
  issuedOn: true,
  amount: true,
  currency: true,
  tax: true,
};

function draftFromAskedReview(review) {
  return {
    vendor: review.vendor ?? "",
    number: review.number ?? "",
    issuedOn: review.issuedOn ? review.issuedOn.toISOString().slice(0, 10) : "",
    amount: plainMoney(review.amount),
    currency: review.currency ?? "",
    tax: plainMoney(review.tax),
    documentType: review.documentType === "RECEIPT" ? "RECEIPT" : review.documentType === "INVOICE" ? "INVOICE" : "",
  };
}

async function latestOpenInvoiceAsk() {
  return withDatabase(async (db) => {
    const sent = await db.telegramDispatch.findMany({
      where: { kind: "invoice.ask", status: "SENT" },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { dedupeKey: true },
    });
    const seen = new Set();
    for (const row of sent) {
      const reviewId = row.dedupeKey.split(":")[1] ?? "";
      if (!reviewId || seen.has(reviewId)) {
        continue;
      }
      seen.add(reviewId);
      const review = await db.invoiceReview.findUnique({ where: { id: reviewId }, select: invoiceReviewSelect });
      if (!review || review.documentType === "STATEMENT") {
        continue;
      }
      if (review.status === "PENDING" || review.status === "HELD") {
        return review;
      }
    }
    return null;
  });
}

async function todayMealList(day = istanbulToday()) {
  return withDatabase(async (db) => {
    const menu = await db.mealMenu.findUnique({
      where: { date: dateOnly(day) },
      select: {
        orders: {
          where: { status: { not: "CANCELLED" } },
          select: {
            absent: true,
            note: true,
            user: { select: { name: true } },
            item: { select: { name: true } },
            soupItem: { select: { name: true } },
            sideItem: { select: { name: true } },
            dessertItem: { select: { name: true } },
          },
        },
        guestOrders: {
          select: {
            guestName: true,
            note: true,
            item: { select: { name: true } },
            soupItem: { select: { name: true } },
            sideItem: { select: { name: true } },
            dessertItem: { select: { name: true } },
          },
        },
      },
    });
    const people = menu ? rosterPeople(menu.orders, menu.guestOrders) : [];
    people.sort((left, right) => left.name.localeCompare(right.name, "tr"));
    const text = formatMealRoster(day, people);
    const settings = await db.mealSettings.findUnique({
      where: { id: MEAL_SETTINGS_ID },
      select: { catererPhone: true },
    });
    return { text, link: settings?.catererPhone ? catererWhatsappLink(settings.catererPhone, text) : null };
  });
}

async function handleIncoming(input) {
  const emailDecision = input.data ? parseEmailLinkCallback(input.data) : null;
  if (emailDecision) {
    const actor = await linkedAdmin(input.telegramUserId, input.chatId);
    if (!actor) {
      return one(reply(input, "Bu Telegram hesabı yönetici olarak bağlı değil."));
    }
    try {
      const result = await decideTelegramEmailLink({
        actor,
        requestId: emailDecision.requestId,
        decision: emailDecision.decision,
      });
      if (result.outcome === "missing") {
        return one(reply(input, "İstek bulunamadı."));
      }
      if (result.outcome === "expired") {
        return one(reply(input, "Süre doldu. Kişi yeniden /start yazsın."));
      }
      if (result.outcome === "taken") {
        return one(reply(input, "Bu Telegram hesabı kullanılamıyor."));
      }
      const approved = result.outcome === "approved";
      return [
        reply(input, approved ? `${result.name} bağlandı.` : "İstek reddedildi."),
        {
          chatId: result.employeeChatId,
          text: approved ? "Hesap bağlandı." : "Bağlantı isteği reddedildi.",
        },
      ];
    } catch (error) {
      return one(reply(input, toPublicError(error).message));
    }
  }

  const command = input.text ? parseTelegramCommand(input.text) : null;
  if (command && (command.name === "start" || command.name === "bagla")) {
    if (!command.argument) {
      const started = await beginTelegramEmailLink({
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
      });
      if (started.kind === "already") {
        return one(reply(input, "Hesap zaten bağlı."));
      }
      return one(reply(input, "Paneldeki e-posta adresinizi yazın."));
    }
    try {
      await consumeTelegramPairing({
        code: command.argument,
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
      });
      await withDatabase((db) => pushRenewalReminders(db, istanbulToday()));
      return one(reply(input, "Hesap bağlandı."));
    } catch (error) {
      return one(reply(input, toPublicError(error).message));
    }
  }

  if (input.text && !command) {
    const submitted = await submitTelegramEmail({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      email: input.text,
    });
    if (submitted.kind === "expired") {
      return one(reply(input, "Süre doldu. Yeniden /start yazın."));
    }
    if (submitted.kind === "invalid") {
      return one(reply(input, "Geçerli bir e-posta yazın."));
    }
    if (submitted.kind === "unknown") {
      return one(reply(input, "Bu e-posta panelde yok."));
    }
    if (submitted.kind === "account-taken") {
      return one(reply(input, "Bu hesabın Telegram'ı zaten bağlı."));
    }
    if (submitted.kind === "telegram-taken") {
      return one(reply(input, "Bu Telegram hesabı kullanılamıyor."));
    }
    if (submitted.kind === "no-admin") {
      return one(reply(input, "Yönetici Telegram'ı bağlı değil. İstek iletilemedi."));
    }
    if (submitted.kind === "pending") {
      return [
        reply(input, "İstek yöneticiye iletildi. Onay bekleniyor."),
        ...submitted.adminChatIds.map((chatId) => ({
          chatId,
          text: `${submitted.name} bağlanmak istiyor.`,
          buttons: [[
            { text: "Onayla", data: emailLinkCallback("APPROVED", submitted.requestId) },
            { text: "Reddet", data: emailLinkCallback("REJECTED", submitted.requestId) },
          ]],
        })),
      ];
    }
  }

  const workReply = input.data ? parseWorkReplyCallback(input.data) : null;
  if (workReply) {
    const worker = await linkedWorker(input.telegramUserId, input.chatId);
    if (!worker) {
      return one(reply(input, "Bu Telegram hesabı panele bağlı değil."));
    }
    const opened = await beginWorkReply(input.telegramUserId, workReply.taskId);
    if (!opened) {
      return one(reply(input, "Kart bulunamadı."));
    }
    return one(reply(input, formatWorkReplyPrompt(opened.title, opened.names)));
  }

  if (command?.name === "vazgec") {
    const pending = await pendingWorkReply(input.telegramUserId);
    if (pending === "expired") {
      return one(reply(input, "Süre doldu. Bildirimdeki Cevapla'ya yeniden bas."));
    }
    if (!pending) {
      return one(reply(input, "Bekleyen yorum cevabı yok."));
    }
    await clearWorkReply(input.telegramUserId);
    return one(reply(input, "Yorum cevabı iptal edildi."));
  }

  if ((input.text || input.photoFileId) && !command) {
    const pending = await pendingWorkReply(input.telegramUserId);
    if (pending === "expired") {
      return one(reply(input, "Süre doldu. Bildirimdeki Cevapla'ya yeniden bas."));
    }
    if (pending) {
      const worker = await linkedWorker(input.telegramUserId, input.chatId);
      if (!worker) {
        return one(reply(input, "Bu Telegram hesabı panele bağlı değil."));
      }
      const body = (input.text ?? "").trim();
      if (body.length > 2000) {
        return one(reply(input, "Yorum en fazla 2000 karakter olabilir. Daha kısasını yaz."));
      }
      try {
        const images = [];
        if (input.photoFileId) {
          const token = telegramBotToken();
          if (!token) return one(reply(input, "Telegram görseli alınamadı."));
          const file = await downloadTelegramFile(input.photoFileId, { token });
          if (!file.ok) return one(reply(input, file.error));
          images.push(inspectWorkImage(file.bytes).bytes);
        }
        await addWorkComment(worker, { taskId: pending.taskId, body, images });
        await clearWorkReply(input.telegramUserId);
        return one(reply(input, "Yorum karta eklendi."));
      } catch (error) {
        return one(reply(input, toPublicError(error).message));
      }
    }
  }

  const actor = await linkedAdmin(input.telegramUserId, input.chatId);
  if (!actor) {
    return one(reply(input, "Bu Telegram hesabı yönetici olarak bağlı değil."));
  }

  if (command?.name === "izin") {
    const items = await pendingLeaves();
    return one(reply(input, formatPendingLeaves(items), items.length > 0 ? leaveDecisionButtons(items) : undefined));
  }

  if (command?.name === "yemek") {
    const list = await todayMealList();
    return one(reply(input, list.text, list.link ? [[{ text: "Yemekçiye ilet", url: list.link }]] : undefined));
  }

  const spoken = input.text ? parseInvoiceReply(input.text) : null;
  const invoiceDecision = input.data ? parseInvoiceCallback(input.data) : null;
  if (spoken || invoiceDecision) {
    try {
      const review = invoiceDecision
        ? await withDatabase((db) => db.invoiceReview.findUnique({
          where: { id: invoiceDecision.reviewId },
          select: invoiceReviewSelect,
        }))
        : await latestOpenInvoiceAsk();
      if (!review) {
        return one(reply(input, invoiceDecision ? "Fatura incelemesi bulunamadı." : "Bekleyen fatura onayı yok."));
      }
      const decision = invoiceDecision?.decision ?? spoken;
      const raw = draftFromAskedReview(review);
      if (decision === "reject") {
        await decideInvoiceReview(actor, review.id, "reject", raw);
        return one(reply(input, "Belge fatura olarak işlenmedi."));
      }
      const draft = confirmedInvoiceDraft(raw, review.id, istanbulToday());
      const result = await decideInvoiceReview(actor, review.id, "approve", draft);
      if (result.outcome === "approved" || result.outcome === "already" || result.outcome === "drive-failed") {
        return one(reply(input, formatInvoiceProcessed({
          vendor: draft.vendor,
          number: draft.number,
          amount: draft.amount,
          currency: draft.currency,
          issuedOn: draft.issuedOn,
          driveFailed: result.outcome === "drive-failed",
        })));
      }
      return one(reply(input, "Fatura işlenemedi."));
    } catch (error) {
      return one(reply(input, toPublicError(error).message));
    }
  }

  const decision = input.data ? parseLeaveCallback(input.data) : null;
  if (!decision) {
    return one(reply(input, "Komut anlaşılamadı. Yemek listesi için /yemek, bekleyen izinler için /izin yazın."));
  }

  try {
    const reviewed = await reviewLeaveRequest(actor, decision.requestId, {
      decision: decision.decision,
      reviewNote: decision.decision === "APPROVED" ? "Telegram üzerinden onaylandı." : "Telegram üzerinden reddedildi.",
      balanceException: false,
    });
    const employeeNote = reviewed.employeeNotified ? " Çalışana Telegram'dan yazıldı." : " Çalışanın Telegram hesabı bağlı değil.";
    return one(reply(input, `${decision.decision === "APPROVED" ? "İzin talebi onaylandı." : "İzin talebi reddedildi."}${employeeNote}`));
  } catch (error) {
    return one(reply(input, toPublicError(error).message));
  }
}

export async function handleTelegramUpdate(update) {
  try {
    const incoming = readTelegramUpdate(update);
    if (!incoming) {
      return [];
    }
    return await handleIncoming(incoming);
  } catch {
    return [];
  }
}
