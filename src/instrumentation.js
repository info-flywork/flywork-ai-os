
import { assertProductionEnv } from "@/server/runtime/productionEnv";
import { redact } from "@/server/runtime/redact";
import { localTelegramPollEnabled } from "@/server/telegram/poll";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  assertProductionEnv();
  if (!localTelegramPollEnabled(process.env) || globalThis.__flyworkTelegramPoll) {
    return;
  }
  globalThis.__flyworkTelegramPoll = true;
  console.log("Telegram düğmeleri dinleniyor.");
  const token = process.env.TELEGRAM_BOT_TOKEN.trim();
  const { runLocalTelegramPoll } = await import("@/server/telegram/poll");
  const { acceptTelegramUpdate } = await import("@/server/telegram/incoming");
  void runLocalTelegramPoll({
    token,
    shouldStop: () => false,
    onUpdate: (update) => acceptTelegramUpdate(update),
  }).catch(() => {
    globalThis.__flyworkTelegramPoll = false;
    console.error("Telegram gelen kutusu okunamadı.");
  });
}

export const onRequestError = async (error, request, context) => {
  const message = error instanceof Error ? error.message : "İstek tamamlanamadı.";
  const digest = typeof error === "object" && error && "digest" in error ? String(error.digest) : "";
  console.error(
    `İstek hatası ${request.method} ${context.routePath} ${redact(message).slice(0, 300)}${digest ? ` ${digest}` : ""}`,
  );
};
