import "server-only";
import { getPrisma } from "@/server/db";
import type { TelegramDelivery } from "@/server/telegram/config";
import { deliverTelegram, type DispatchResult, type TelegramButton, type TelegramSend } from "@/server/telegram/send";

export type { DispatchResult, TelegramButton, TelegramSend };

export async function dispatchTelegramMessage(input: {
  dedupeKey: string;
  kind: string;
  chatId: string;
  text: string;
  delivery: TelegramDelivery;
  buttons?: TelegramButton[][];
  transport?: TelegramSend;
}): Promise<DispatchResult> {
  return deliverTelegram(getPrisma(), input);
}

export async function dispatchTelegramBatch(
  messages: { dedupeKey: string; kind: string; text: string }[],
  options: { chatId: string; delivery: TelegramDelivery; transport?: TelegramSend },
): Promise<{ sent: number; failed: number; skipped: number; duplicate: number }> {
  const totals = { sent: 0, failed: 0, skipped: 0, duplicate: 0 };
  for (const message of messages) {
    const result = await dispatchTelegramMessage({ ...message, ...options });
    totals[result.status] += 1;
  }
  return totals;
}
