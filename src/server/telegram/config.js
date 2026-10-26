 







export function telegramStatus(env = process.env) {
  const configured = (env.TELEGRAM_BOT_TOKEN ?? "").trim().length > 0;
  const delivery = configured && env.TELEGRAM_DELIVERY === "live" ? "live" : "off";
  return {
    configured,
    delivery,
    missing: configured ? [] : ["TELEGRAM_BOT_TOKEN"],
  };
}

export function telegramBotToken(env = process.env) {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  return token.length > 0 ? token : null;
}

export function telegramWebhookSecret(env = process.env) {
  const secret = (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  return secret.length > 0 ? secret : null;
}
