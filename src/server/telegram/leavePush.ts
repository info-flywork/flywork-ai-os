import type { PrismaClient } from "@/generated/prisma/client";
import { toIsoDate } from "@/server/dates";
import { withDatabase } from "@/server/db";
import {
  formatLeaveDecisionNotice,
  formatLeaveRequestNotice,
  leaveDecisionButtons,
} from "@/server/telegram/messages";
import { deliverTelegram, liveTelegramTransport } from "@/server/telegram/send";

type Db = PrismaClient;

function dayLabel(value: { toFixed(digits: number): string }) {
  return value.toFixed(2).replace(".", ",");
}

function clock(value: Date) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

async function adminLinks(db: Db) {
  return db.telegramLink.findMany({
    where: { revokedAt: null, user: { role: "ADMIN", active: true, approver: true } },
    select: { userId: true, chatId: true },
  });
}

export async function notifyLeaveRequested(requestId: string): Promise<boolean> {
  try {
    return await withDatabase(async (db) => {
      const request = await db.leaveRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          type: true,
          duration: true,
          startDate: true,
          endDate: true,
          startsAt: true,
          endsAt: true,
          dayCount: true,
          reason: true,
          user: { select: { name: true } },
        },
      });
      if (!request) {
        return false;
      }
      const admins = await adminLinks(db);
      if (admins.length === 0) {
        return false;
      }
      const channel = liveTelegramTransport();
      const text = formatLeaveRequestNotice({
        id: request.id,
        employeeName: request.user.name,
        type: request.type,
        startDate: toIsoDate(request.startDate),
        endDate: toIsoDate(request.endDate),
        dayCount: dayLabel(request.dayCount),
        reason: request.reason,
        time: request.duration === "HOURLY" ? `${clock(request.startsAt)}–${clock(request.endsAt)}` : null,
      });
      const buttons = leaveDecisionButtons([
        {
          id: request.id,
          employeeName: request.user.name,
          type: request.type,
          startDate: toIsoDate(request.startDate),
          endDate: toIsoDate(request.endDate),
          dayCount: dayLabel(request.dayCount),
        },
      ]);
      let sent = false;
      for (const admin of admins) {
        const result = await deliverTelegram(db, {
          dedupeKey: `leave.request:${request.id}:${admin.userId}`,
          kind: "leave.request",
          chatId: admin.chatId,
          text,
          buttons,
          delivery: channel.delivery,
          transport: channel.transport,
        });
        sent = sent || result.status === "sent";
      }
      return sent;
    });
  } catch {
    return false;
  }
}

export async function notifyLeaveDecision(requestId: string, decision: "APPROVED" | "REJECTED"): Promise<boolean> {
  try {
    return await withDatabase(async (db) => {
      const request = await db.leaveRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          dayCount: true,
          user: { select: { id: true } },
        },
      });
      if (!request) {
        return false;
      }
      const link = await db.telegramLink.findUnique({
        where: { userId: request.user.id },
        select: { chatId: true, revokedAt: true, user: { select: { active: true } } },
      });
      if (!link || link.revokedAt || !link.user.active) {
        return false;
      }
      const channel = liveTelegramTransport();
      const result = await deliverTelegram(db, {
        dedupeKey: `leave.decision:${request.id}:${decision}`,
        kind: "leave.decision",
        chatId: link.chatId,
        text: formatLeaveDecisionNotice({
          decision,
          startDate: toIsoDate(request.startDate),
          endDate: toIsoDate(request.endDate),
          dayCount: dayLabel(request.dayCount),
        }),
        delivery: channel.delivery,
        transport: channel.transport,
      });
      return result.status === "sent";
    });
  } catch {
    return false;
  }
}
