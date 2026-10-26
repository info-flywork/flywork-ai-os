import "server-only";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import { dateOnly, istanbulToday, toIsoDate } from "@/server/dates";
import { MEAL_SETTINGS_ID, catererWhatsappLink, formatMealRoster } from "@/server/meals/schedule";
import { rosterPeople } from "@/server/telegram/mealPush";
import { withDatabase } from "@/server/db";
import { toPublicError } from "@/server/errors";
import { reviewLeaveRequest } from "@/server/services/leave";
import { decideInvoiceReview } from "@/server/services/invoiceReview";
import { pushRenewalReminders } from "@/server/telegram/renewals";
import { beginTelegramEmailLink, consumeTelegramPairing, decideTelegramEmailLink, submitTelegramEmail } from "@/server/telegram/pairing";
import {
  emailLinkCallback,
  formatInvoiceProcessed,
  formatPendingLeaves,
  leaveDecisionButtons,
  parseEmailLinkCallback,
  parseInvoiceCallback,
  parseLeaveCallback,
  parseTelegramCommand,
  type LeaveListItem,
} from "@/server/telegram/messages";

export type TelegramOutbound = {
  chatId: string;
  text: string;
  buttons?: { text: string; data?: string; url?: string }[][];
  callbackQueryId?: string;
};

type Incoming = {
  text?: string;
  data?: string;
  telegramUserId: string;
  chatId: string;
  callbackQueryId?: string;
};

function plainMoney(value: { toString(): string } | null): string {
  if (!value) {
    return "";
  }
  const number = Number(value.toString());
  if (!Number.isFinite(number)) {
    return "";
  }
  return number.toFixed(2);
}

function reply(input: Incoming, text: string, buttons?: TelegramOutbound["buttons"]): TelegramOutbound {
  return {
    chatId: input.chatId,
    text,
    buttons,
    callbackQueryId: input.callbackQueryId,
  };
}

function privateIds(from: unknown, chat: unknown): { telegramUserId: string; chatId: string } | null {
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

export function readTelegramUpdate(update: unknown): Incoming | null {
  if (!update || typeof update !== "object") {
    return null;
  }
  if ("message" in update && update.message && typeof update.message === "object") {
    const message = update.message;
    const ids = privateIds("from" in message ? message.from : undefined, "chat" in message ? message.chat : undefined);
    const text = "text" in message && typeof message.text === "string" ? message.text : "";
    if (!ids || text.length === 0 || text.length > 80) {
      return null;
    }
    return { ...ids, text };
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

async function linkedAdmin(telegramUserId: string, chatId: string): Promise<Actor | null> {
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

async function pendingLeaves(): Promise<LeaveListItem[]> {
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

function one(message: TelegramOutbound): TelegramOutbound[] {
  return [message];
}

async function todayMealList(day = istanbulToday()): Promise<{ text: string; link: string | null }> {
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

async function handleIncoming(input: Incoming): Promise<TelegramOutbound[]> {
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

  const invoiceDecision = input.data ? parseInvoiceCallback(input.data) : null;
  if (invoiceDecision) {
    try {
      const review = await withDatabase((db) =>
        db.invoiceReview.findUnique({
          where: { id: invoiceDecision.reviewId },
          select: {
            vendor: true,
            number: true,
            issuedOn: true,
            amount: true,
            currency: true,
            tax: true,
            documentType: true,
          },
        }),
      );
      if (!review) {
        return one(reply(input, "Fatura incelemesi bulunamadı."));
      }
      const draft = {
        vendor: review.vendor ?? "",
        number: review.number ?? "",
        issuedOn: review.issuedOn ? review.issuedOn.toISOString().slice(0, 10) : "",
        amount: plainMoney(review.amount),
        currency: review.currency ?? "",
        tax: plainMoney(review.tax),
        documentType: review.documentType === "RECEIPT" ? "RECEIPT" : "INVOICE",
      };
      if (invoiceDecision.decision === "reject") {
        await decideInvoiceReview(actor, invoiceDecision.reviewId, "reject", draft);
        return one(reply(input, "Belge fatura olarak işlenmedi."));
      }
      const result = await decideInvoiceReview(actor, invoiceDecision.reviewId, "approve", draft);
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

export async function handleTelegramUpdate(update: unknown): Promise<TelegramOutbound[]> {
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
