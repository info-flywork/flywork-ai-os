import "server-only";

import { handleTelegramUpdate } from "@/server/telegram/commands";
import { postTelegram } from "@/server/telegram/client";
import { telegramBotToken, telegramStatus } from "@/server/telegram/config";
import { claimTelegramUpdate, telegramUpdateId } from "@/server/telegram/updates";

function callbackQueryId(update) {
  if (!update || typeof update !== "object" || !("callback_query" in update)) {
    return "";
  }
  const query = update.callback_query;
  if (!query || typeof query !== "object" || !("id" in query) || typeof query.id !== "string") {
    return "";
  }
  return query.id;
}

function replyMarkup(item) {
  if (!item.buttons) {
    return undefined;
  }
  return {
    inline_keyboard: item.buttons.map((row) =>
      row.map((button) => button.url
        ? { text: button.text, url: button.url }
        : { text: button.text, callback_data: button.data ?? "" }),
    ),
  };
}

export async function acceptTelegramUpdate(update, env = process.env) {
  const token = telegramBotToken(env);
  const live = telegramStatus(env).delivery === "live" && Boolean(token);
  const pressed = callbackQueryId(update);
  if (live && pressed) {
    await postTelegram("answerCallbackQuery", { callback_query_id: pressed }, { token });
  }

  const updateId = telegramUpdateId(update);
  if (!updateId || (await claimTelegramUpdate(updateId)) === "duplicate") {
    return;
  }

  const outbound = await handleTelegramUpdate(update);
  if (!live) {
    return;
  }
  for (const item of outbound) {
    await postTelegram(
      "sendMessage",
      {
        chat_id: item.chatId,
        text: item.text,
        reply_markup: replyMarkup(item),
      },
      { token },
    );
  }
}
