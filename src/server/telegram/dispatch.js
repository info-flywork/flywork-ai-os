import "server-only";
import { getPrisma } from "@/server/db";

import { deliverTelegram } from "@/server/telegram/send";

;

export async function dispatchTelegramMessage(input







) {
  return deliverTelegram(getPrisma(), input);
}

export async function dispatchTelegramBatch(
  messages,
  options,
) {
  const totals = { sent: 0, failed: 0, skipped: 0, duplicate: 0 };
  for (const message of messages) {
    const result = await dispatchTelegramMessage({ ...message, ...options });
    totals[result.status] += 1;
  }
  return totals;
}
