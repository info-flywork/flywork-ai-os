import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { MailAnalysis } from "@/server/google/mailbox";
import { formatMailSummary } from "@/server/telegram/messages";
import { deliverTelegram, liveTelegramTransport } from "@/server/telegram/send";

type Db = PrismaClient | Prisma.TransactionClient;

export async function pushMailSummary(
  db: Db,
  slot: "sabah" | "aksam",
  date: string,
  report: MailAnalysis,
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
  const [year, month, day] = date.split("-");
  const text = formatMailSummary(slot === "sabah" ? "Sabah" : "Akşam", report, year && month && day ? `${day}.${month}.${year}` : undefined);
  let sent = 0;
  for (const admin of admins) {
    const result = await deliverTelegram(db, {
      dedupeKey: `gmail.summary:${date}:${slot}:${admin.userId}`,
      kind: "gmail.summary",
      chatId: admin.chatId,
      text,
      delivery: channel.delivery,
      transport: channel.transport,
    });
    if (result.status === "sent") {
      sent += 1;
    }
  }
  return sent;
}
