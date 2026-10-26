import type { PrismaClient } from "@/generated/prisma/client";
import { toIsoDate } from "@/server/dates";
import { formatWorkDeadlineReminder, reminderKind, taskDeadline } from "@/lib/workDeadline";
import { deliverTelegram, liveTelegramTransport } from "@/server/telegram/send";

export async function remindWorkDeadlines(db: PrismaClient, now = new Date()): Promise<number> {
  const channel = liveTelegramTransport();
  if (channel.delivery !== "live" || !channel.transport) {
    return 0;
  }
  const tasks = await db.workTask.findMany({
    where: { completed: false, column: { not: "DONE" }, assignees: { some: {} } },
    select: {
      id: true,
      title: true,
      dueOn: true,
      startsOn: true,
      endsAt: true,
      startsAt: true,
      assignees: { select: { userId: true } },
    },
  });
  const due = tasks.flatMap((task) => {
    const deadline = taskDeadline({
      dueOn: task.dueOn ? toIsoDate(task.dueOn) : null,
      startsOn: task.startsOn ? toIsoDate(task.startsOn) : null,
      endsAt: task.endsAt,
      startsAt: task.startsAt,
    });
    const kind = deadline ? reminderKind(deadline, now) : null;
    return deadline && kind ? [{ id: task.id, title: task.title, deadline, kind, userIds: task.assignees.map((assignee) => assignee.userId) }] : [];
  });
  if (due.length === 0) {
    return 0;
  }
  const links = await db.telegramLink.findMany({
    where: {
      revokedAt: null,
      userId: { in: [...new Set(due.flatMap((task) => task.userIds))] },
      user: { active: true },
    },
    select: { userId: true, chatId: true },
  });
  const chats = new Map(links.map((link) => [link.userId, link.chatId]));
  let sent = 0;
  for (const task of due) {
    const text = formatWorkDeadlineReminder(task);
    for (const userId of task.userIds) {
      const chatId = chats.get(userId);
      if (!chatId) continue;
      const result = await deliverTelegram(db, {
        dedupeKey: `work.due:${task.id}:${task.deadline}:${task.kind}:${userId}`,
        kind: "work.deadline",
        chatId,
        text,
        delivery: channel.delivery,
        transport: channel.transport,
      });
      if (result.status === "sent") sent += 1;
    }
  }
  return sent;
}
