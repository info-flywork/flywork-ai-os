import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { toIsoDate } from "@/server/dates";
import { formatPendingLeaveApprovals, leaveApprovalButtons, type LeaveListItem } from "@/server/telegram/messages";
import { deliverTelegram, liveTelegramTransport } from "@/server/telegram/send";

type Db = PrismaClient | Prisma.TransactionClient;

export async function pushPendingLeaveApprovals(db: Db, date: string): Promise<number> {
  const rows = await db.leaveRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      id: true,
      type: true,
      startDate: true,
      endDate: true,
      dayCount: true,
      user: { select: { name: true } },
    },
  });
  if (rows.length === 0) {
    return 0;
  }
  const admins = await db.telegramLink.findMany({
    where: { revokedAt: null, user: { role: "ADMIN", active: true, approver: true } },
    select: { userId: true, chatId: true },
  });
  if (admins.length === 0) {
    return 0;
  }
  const channel = liveTelegramTransport();
  if (channel.delivery !== "live" || !channel.transport) {
    return 0;
  }
  const items: LeaveListItem[] = rows.map((row) => ({
    id: row.id,
    employeeName: row.user.name,
    type: row.type,
    startDate: toIsoDate(row.startDate),
    endDate: toIsoDate(row.endDate),
    dayCount: row.dayCount.toFixed(2).replace(".", ","),
  }));
  const text = formatPendingLeaveApprovals(items);
  const buttons = leaveApprovalButtons(items);
  let sent = 0;
  for (const admin of admins) {
    const result = await deliverTelegram(db, {
      dedupeKey: `leave.pending:${date}:${admin.userId}`,
      kind: "leave.pending",
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
