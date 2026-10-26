
import { toIsoDate } from "@/server/dates";
import { formatRenewalReminder } from "@/server/telegram/messages";
import { deliverTelegram, liveTelegramTransport } from "@/server/telegram/send";
import { daysUntil, RENEWAL_REMINDER_DAYS } from "@/server/technology/schedule";

const REMINDER_DAYS = RENEWAL_REMINDER_DAYS;



export async function pushRenewalReminders(db, today) {
  const admins = await db.telegramLink.findMany({
    where: { revokedAt: null, user: { role: "ADMIN", active: true } },
    select: { userId: true, chatId: true },
  });
  if (admins.length === 0) {
    return 0;
  }
  const channel = liveTelegramTransport();
  if (channel.delivery !== "live" || !channel.transport) {
    return 0;
  }
  const subscriptions = await db.technologySubscription.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, renewsOn: true },
  });
  let sent = 0;
  for (const subscription of subscriptions) {
    const dueOn = toIsoDate(subscription.renewsOn);
    const remaining = daysUntil(today, dueOn);
    if (!REMINDER_DAYS.includes(remaining)) {
      continue;
    }
    const text = formatRenewalReminder({ name: subscription.name, dueOn, days: remaining });
    for (const admin of admins) {
      const result = await deliverTelegram(db, {
        dedupeKey: `renewal:${subscription.id}:${dueOn}:${remaining}:${admin.userId}`,
        kind: "subscription.renewal",
        chatId: admin.chatId,
        text,
        delivery: channel.delivery,
        transport: channel.transport,
      });
      if (result.status === "sent") {
        sent += 1;
      }
    }
  }
  return sent;
}
