import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { redact } from "@/server/runtime/redact";
import { postTelegram } from "@/server/telegram/client";
import { telegramBotToken, telegramStatus, type TelegramDelivery } from "@/server/telegram/config";

type Db = PrismaClient | Prisma.TransactionClient;

export type TelegramButton = { text: string; data?: string; url?: string };

export type TelegramSend = (body: {
  chat_id: string;
  text: string;
  reply_markup?: { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };
}) => Promise<void>;

export type DispatchResult = {
  status: "skipped" | "sent" | "duplicate" | "failed";
  error?: string;
};

async function claim(db: Db, dedupeKey: string, kind: string): Promise<"send" | "duplicate" | "failed"> {
  try {
    await db.telegramDispatch.create({ data: { dedupeKey, kind, status: "CLAIMED" } });
    return "send";
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return "failed";
    }
  }
  const existing = await db.telegramDispatch.findUnique({ where: { dedupeKey } });
  if (existing?.status !== "FAILED") {
    return "duplicate";
  }
  const retried = await db.telegramDispatch.updateMany({
    where: { dedupeKey, status: "FAILED" },
    data: { status: "CLAIMED", error: null },
  });
  return retried.count === 1 ? "send" : "duplicate";
}

export function liveTelegramTransport(): { delivery: TelegramDelivery; transport?: TelegramSend } {
  const status = telegramStatus();
  const token = telegramBotToken();
  if (status.delivery !== "live" || !token) {
    return { delivery: "off" };
  }
  return {
    delivery: "live",
    transport: async (body) => {
      const result = await postTelegram("sendMessage", body, { token });
      if (!result.ok) {
        throw new Error(result.error);
      }
    },
  };
}

export async function deliverTelegram(
  db: Db,
  input: {
    dedupeKey: string;
    kind: string;
    chatId: string;
    text: string;
    delivery: TelegramDelivery;
    buttons?: TelegramButton[][];
    transport?: TelegramSend;
  },
): Promise<DispatchResult> {
  if (input.delivery !== "live" || !input.chatId) {
    return { status: "skipped" };
  }
  try {
    const claimed = await claim(db, input.dedupeKey, input.kind);
    if (claimed !== "send") {
      return { status: claimed };
    }
    try {
      if (!input.transport) {
        throw new Error("Telegram erişilemedi.");
      }
      await input.transport({
        chat_id: input.chatId,
        text: input.text,
        ...(input.buttons && input.buttons.length > 0
          ? {
              reply_markup: {
                inline_keyboard: input.buttons.map((row) =>
                  row.map((button) => button.url
                    ? { text: button.text, url: button.url }
                    : { text: button.text, callback_data: button.data ?? "" }),
                ),
              },
            }
          : {}),
      });
      await db.telegramDispatch.update({
        where: { dedupeKey: input.dedupeKey },
        data: { status: "SENT", error: null },
      });
      return { status: "sent" };
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : "Telegram erişilemedi.").slice(0, 180);
      const safe = message.includes("[gizli") ? "Telegram erişilemedi." : message || "Telegram erişilemedi.";
      await db.telegramDispatch.update({
        where: { dedupeKey: input.dedupeKey },
        data: { status: "FAILED", error: safe },
      });
      return { status: "failed", error: safe };
    }
  } catch {
    return { status: "failed", error: "Telegram erişilemedi." };
  }
}
