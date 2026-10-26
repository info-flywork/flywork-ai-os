import type { NoticeSubject, Prisma, PrismaClient } from "@/generated/prisma/client";
import { dateOnly, istanbulToday, toIsoDate } from "@/server/dates";
import { daysUntil, reminderThresholds } from "@/server/technology/schedule";

type NoticeDb = PrismaClient | Prisma.TransactionClient;

export async function writeRenewalNotices(db: NoticeDb, today = istanbulToday()): Promise<number> {
  const subscriptions = await db.technologySubscription.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      renewsOn: true,
      domainExpiresOn: true,
      sslExpiresOn: true,
    },
  });
  const data: {
    subscriptionId: string;
    subject: NoticeSubject;
    dueOn: Date;
    thresholdDays: number;
  }[] = [];

  for (const subscription of subscriptions) {
    const points: { subject: NoticeSubject; dueOn: string }[] = [
      { subject: "BILLING", dueOn: toIsoDate(subscription.renewsOn) },
    ];
    if (subscription.domainExpiresOn) {
      points.push({ subject: "DOMAIN", dueOn: toIsoDate(subscription.domainExpiresOn) });
    }
    if (subscription.sslExpiresOn) {
      points.push({ subject: "SSL", dueOn: toIsoDate(subscription.sslExpiresOn) });
    }
    for (const point of points) {
      const remaining = daysUntil(today, point.dueOn);
      if (remaining > 30) {
        continue;
      }
      for (const thresholdDays of reminderThresholds(remaining)) {
        data.push({
          subscriptionId: subscription.id,
          subject: point.subject,
          dueOn: dateOnly(point.dueOn),
          thresholdDays,
        });
      }
    }
  }

  if (data.length === 0) {
    return 0;
  }
  const result = await db.subscriptionNotice.createMany({ data, skipDuplicates: true });
  return result.count;
}
