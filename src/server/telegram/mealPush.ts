import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { catererWhatsappLink, formatMealRoster, mealLine, orderedMeals } from "@/server/meals/schedule";
import { deliverTelegram, liveTelegramTransport } from "@/server/telegram/send";

type Db = PrismaClient | Prisma.TransactionClient;

type RosterOrder = {
  absent?: boolean;
  note?: string | null;
  item?: { name: string } | null;
  soupItem?: { name: string } | null;
  sideItem?: { name: string } | null;
  dessertItem?: { name: string } | null;
};

export async function pushMealRoster(
  db: Db,
  date: string,
  people: { name: string; meal: string }[],
  phone?: string | null,
): Promise<number> {
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
  const meals = orderedMeals(people);
  const text = formatMealRoster(date, meals);
  const link = phone ? catererWhatsappLink(phone, text) : null;
  const buttons = link ? [[{ text: "Yemekçiye ilet", url: link }]] : undefined;
  let sent = 0;
  for (const admin of admins) {
    const result = await deliverTelegram(db, {
      dedupeKey: `meal.roster:${date}:${admin.userId}`,
      kind: "meal.close",
      chatId: admin.chatId,
      text,
      buttons,
      delivery: channel.delivery,
      transport: channel.transport,
    });
    if (result.status === "sent") {
      sent += 1;
    }
  }
  return sent;
}

export function rosterPeople(
  orders: (RosterOrder & { user: { name: string } })[],
  guests: (RosterOrder & { guestName: string })[],
) {
  return [
    ...orders.map((order) => ({ name: order.user.name, meal: mealLine(order), note: order.note })),
    ...guests.map((order) => ({ name: order.guestName, meal: mealLine(order), note: order.note })),
  ];
}
