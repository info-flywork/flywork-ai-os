
import { dateOnly, istanbulToday, toIsoDate } from "@/server/dates";
import { daysUntil, reminderThresholds } from "@/server/technology/schedule";



export async function writeRenewalNotices(db, today = istanbulToday()) {
  const subscriptions = await db.technologySubscription.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      renewsOn: true,
      domainExpiresOn: true,
      sslExpiresOn: true,
    },
  });
  const data




 = [];

  for (const subscription of subscriptions) {
    const points = [
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
