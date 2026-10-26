 









function webhookUrlReady(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname === "/api/telegram/webhook" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export function webhookSetupPlan(
  env,
  args,
) {
  const tokenPresent = (env.TELEGRAM_BOT_TOKEN ?? "").trim().length > 0;
  const secretPresent = (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim().length >= 32;
  const url = (env.TELEGRAM_WEBHOOK_URL ?? "").trim();
  const urlReady = webhookUrlReady(url);
  const missing = [
    tokenPresent ? "" : "TELEGRAM_BOT_TOKEN",
    secretPresent ? "" : "TELEGRAM_WEBHOOK_SECRET",
    urlReady ? "" : "TELEGRAM_WEBHOOK_URL",
  ].filter(Boolean);
  const apply = args.includes("--apply");
  return {
    mode: apply ? "apply" : "deneme",
    registered: false,
    tokenPresent,
    secretPresent,
    urlReady,
    deliveryOff: env.TELEGRAM_DELIVERY !== "live",
    missing,
    canApply: apply && missing.length === 0,
  };
}

export async function registerTelegramWebhook(
  env,
  args,
  fetchImpl = fetch,
) {
  const plan = webhookSetupPlan(env, args);
  if (!plan.canApply) {
    return {
      mode: plan.mode,
      registered: false,
      tokenPresent: plan.tokenPresent,
      secretPresent: plan.secretPresent,
      urlReady: plan.urlReady,
      deliveryOff: plan.deliveryOff,
      missing: plan.missing,
    };
  }

  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const secret = (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  const url = (env.TELEGRAM_WEBHOOK_URL ?? "").trim();
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
      }),
    });
    const body = await response.json().catch(() => null);
    const registered = response.ok && Boolean(body && typeof body === "object" && "ok" in body && body.ok === true);
    return {
      mode: "apply",
      registered,
      tokenPresent: true,
      secretPresent: true,
      urlReady: true,
      deliveryOff: plan.deliveryOff,
      missing: [],
    };
  } catch {
    return {
      mode: "apply",
      registered: false,
      tokenPresent: true,
      secretPresent: true,
      urlReady: true,
      deliveryOff: plan.deliveryOff,
      missing: [],
    };
  }
}
