import { NextResponse } from "next/server";
import { acceptTelegramUpdate } from "@/server/telegram/incoming";
import { telegramWebhookSecret } from "@/server/telegram/config";
import { telegramUpdateId } from "@/server/telegram/updates";
import { webhookAuthorized } from "@/server/telegram/webhookAuth";

const noStore = { "cache-control": "no-store" };

export async function receiveTelegramWebhook(
  request,
  env = process.env,
) {
  if (!webhookAuthorized(request.headers.get("x-telegram-bot-api-secret-token"), telegramWebhookSecret(env))) {
    return NextResponse.json({ ok: false }, { status: 401, headers: noStore });
  }

  let update = null;
  try {
    update = await request.json();
  } catch {
    update = null;
  }

  if (!telegramUpdateId(update)) {
    return NextResponse.json({ ok: true }, { headers: noStore });
  }
  await acceptTelegramUpdate(update, env);
  return NextResponse.json({ ok: true }, { headers: noStore });
}

export function POST(request) {
  return receiveTelegramWebhook(request);
}
