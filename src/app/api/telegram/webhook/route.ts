import { NextResponse } from "next/server";
import { postTelegram } from "@/server/telegram/client";
import { handleTelegramUpdate } from "@/server/telegram/commands";
import { telegramBotToken, telegramStatus, telegramWebhookSecret } from "@/server/telegram/config";
import { claimTelegramUpdate, telegramUpdateId } from "@/server/telegram/updates";
import { webhookAuthorized } from "@/server/telegram/webhookAuth";

const noStore = { "cache-control": "no-store" };

export async function receiveTelegramWebhook(
  request: Request,
  env: Record<string, string | undefined> = process.env,
) {
  if (!webhookAuthorized(request.headers.get("x-telegram-bot-api-secret-token"), telegramWebhookSecret(env))) {
    return NextResponse.json({ ok: false }, { status: 401, headers: noStore });
  }

  let update: unknown = null;
  try {
    update = await request.json();
  } catch {
    update = null;
  }

  const updateId = telegramUpdateId(update);
  if (!updateId) {
    return NextResponse.json({ ok: true }, { headers: noStore });
  }
  if ((await claimTelegramUpdate(updateId)) === "duplicate") {
    return NextResponse.json({ ok: true }, { headers: noStore });
  }

  const outbound = await handleTelegramUpdate(update);
  const token = telegramBotToken(env);
  if (telegramStatus(env).delivery === "live" && token) {
    for (const item of outbound) {
      if (item.callbackQueryId) {
        await postTelegram("answerCallbackQuery", { callback_query_id: item.callbackQueryId }, { token });
      }
      await postTelegram(
        "sendMessage",
        {
          chat_id: item.chatId,
          text: item.text,
          reply_markup: item.buttons
            ? {
                inline_keyboard: item.buttons.map((row) =>
                  row.map((button) => button.url
                    ? { text: button.text, url: button.url }
                    : { text: button.text, callback_data: button.data ?? "" }),
                ),
              }
            : undefined,
        },
        { token },
      );
    }
  }

  return NextResponse.json({ ok: true }, { headers: noStore });
}

export function POST(request: Request) {
  return receiveTelegramWebhook(request);
}
