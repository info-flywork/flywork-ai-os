import type { PrismaClient } from "@/generated/prisma/client";
import { deliverTelegram, liveTelegramTransport } from "@/server/telegram/send";

type Db = PrismaClient;

function clip(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 240 ? `${clean.slice(0, 237)}...` : clean;
}

export function workNoticeRecipients(userIds: string[], actorId: string) {
  return [...new Set(userIds)].filter((id) => id && id !== actorId);
}

export function workCardNotice(actor: string, title: string) {
  return `${actor} bir iş kartı açtı\n${clip(title)}`;
}

export function workAssignNotice(actor: string, title: string) {
  return `${actor} seni bir iş kartına ekledi\n${clip(title)}`;
}

export function workCommentNotice(input: { actor: string; title: string; body: string; mentioned: boolean }) {
  const lead = input.mentioned ? `${input.actor} seni etiketledi` : `${input.actor} bir yorum yazdı`;
  return `${lead}\n${clip(input.title)}\n${clip(input.body)}`;
}

export async function pushWorkNotice(
  db: Db,
  input: {
    kind: string;
    eventId: string;
    userIds: string[];
    textFor: (userId: string) => string;
  },
) {
  const userIds = [...new Set(input.userIds)].filter(Boolean);
  if (userIds.length === 0) {
    return;
  }
  try {
    const channel = liveTelegramTransport();
    if (channel.delivery !== "live" || !channel.transport) {
      return;
    }
    const links = await db.telegramLink.findMany({
      where: { revokedAt: null, userId: { in: userIds }, user: { active: true } },
      select: { userId: true, chatId: true },
    });
    for (const link of links) {
      await deliverTelegram(db, {
        dedupeKey: `${input.kind}:${input.eventId}:${link.userId}`,
        kind: input.kind,
        chatId: link.chatId,
        text: input.textFor(link.userId),
        delivery: channel.delivery,
        transport: channel.transport,
      });
    }
  } catch {
    return;
  }
}
