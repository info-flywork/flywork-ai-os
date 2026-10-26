export function localTelegramPollEnabled(env: Record<string, string | undefined>): boolean {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const secret = (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  const url = (env.TELEGRAM_WEBHOOK_URL ?? "").trim();
  return token.length > 0 && secret.length >= 32 && env.TELEGRAM_DELIVERY === "live" && url.length === 0;
}

type PollOptions = {
  token: string;
  secret: string;
  endpoint: string;
  shouldStop: () => boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

function updateId(update: unknown): number | null {
  if (!update || typeof update !== "object" || !("update_id" in update)) {
    return null;
  }
  const value = update.update_id;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

async function telegramJson(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

export async function runLocalTelegramPoll(options: PollOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  await telegramJson(options.token, "deleteWebhook", { drop_pending_updates: false }, fetchImpl, options.signal);
  let offset = 0;
  while (!options.shouldStop()) {
    const payload = await telegramJson(options.token, "getUpdates", {
      offset,
      timeout: 8,
      allowed_updates: ["message", "callback_query"],
    }, fetchImpl, options.signal);
    const updates = payload && typeof payload === "object" && "ok" in payload && payload.ok === true && "result" in payload && Array.isArray(payload.result)
      ? payload.result
      : [];
    if (updates.length === 0) {
      if (options.shouldStop()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    for (const update of updates) {
      if (options.shouldStop()) {
        return;
      }
      let delivered = false;
      try {
        const response = await fetchImpl(options.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-telegram-bot-api-secret-token": options.secret,
          },
          body: JSON.stringify(update),
          signal: options.signal,
        });
        delivered = response.ok;
      } catch {
        delivered = false;
      }
      const id = updateId(update);
      if (id === null) {
        continue;
      }
      if (!delivered) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        break;
      }
      offset = id + 1;
    }
  }
}
