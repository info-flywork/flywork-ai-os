export type TelegramDelivery = "off" | "live";

export type TelegramStatus = {
  configured: boolean;
  delivery: TelegramDelivery;
  missing: string[];
};

export function telegramStatus(env: Record<string, string | undefined> = process.env): TelegramStatus {
  const configured = (env.TELEGRAM_BOT_TOKEN ?? "").trim().length > 0;
  const delivery: TelegramDelivery = configured && env.TELEGRAM_DELIVERY === "live" ? "live" : "off";
  return {
    configured,
    delivery,
    missing: configured ? [] : ["TELEGRAM_BOT_TOKEN"],
  };
}

export function telegramBotToken(env: Record<string, string | undefined> = process.env): string | null {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  return token.length > 0 ? token : null;
}

export function telegramWebhookSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  return secret.length > 0 ? secret : null;
}
