import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { dateOnly, istanbulToday, toIsoDate } from "@/server/dates";
import { redact } from "@/server/runtime/redact";
import {
  formatAutomationFailure,
  formatInvoiceReviewNotice,
  formatMealCloseMessage,
  formatRenewalNotice,
} from "@/server/telegram/messages";
import { mealOrderTotals } from "@/server/meals/totals";

export type TelegramNotice = {
  dedupeKey: string;
  kind: string;
  text: string;
};

function horizon(today: Date): Date {
  return new Date(today.getTime() + 30 * 86_400_000);
}

export async function loadMealCloseNotice(db: PrismaClient, date: string): Promise<TelegramNotice> {
  const menu = await db.mealMenu.findUnique({
    where: { date: dateOnly(date) },
    include: {
      orders: {
        where: { status: { not: "CANCELLED" } },
        include: {
          item: { select: { name: true } },
          soupItem: { select: { name: true } },
          sideItem: { select: { name: true } },
          dessertItem: { select: { name: true } },
        },
      },
    },
  });
  const totals = mealOrderTotals(menu?.orders ?? []);
  return {
    dedupeKey: `meal.close:${date}`,
    kind: "meal.close",
    text: formatMealCloseMessage(date, totals.rows, totals.absent),
  };
}

export async function loadOperationalNotices(db: PrismaClient, now = new Date()): Promise<TelegramNotice[]> {
  const todayIso = istanbulToday(now);
  const today = dateOnly(todayIso);
  const [reviews, renewals, failures] = await Promise.all([
    db.invoiceReview.findMany({
      where: { status: "PENDING", documentType: { not: "STATEMENT" } },
      orderBy: { createdAt: "asc" },
      take: 30,
      select: { id: true, vendor: true, number: true, fileName: true },
    }),
    db.technologySubscription.findMany({
      where: { active: true, status: "ACTIVE", renewsOn: { lte: horizon(today) } },
      orderBy: { renewsOn: "asc" },
      take: 20,
      select: { id: true, name: true, renewsOn: true },
    }),
    db.automationRun.findMany({
      where: { state: "FAILED" },
      orderBy: { startedAt: "desc" },
      take: 30,
      select: {
        id: true,
        error: true,
        summary: true,
        jobId: true,
        job: { select: { name: true } },
      },
    }),
  ]);
  const seenJobs = new Set<string>();
  const latestFailures = failures.filter((run) => {
    if (seenJobs.has(run.jobId)) {
      return false;
    }
    seenJobs.add(run.jobId);
    return true;
  });

  return [
    ...reviews.map((review) => ({
      dedupeKey: `invoice.review:${review.id}`,
      kind: "invoice.review",
      text: formatInvoiceReviewNotice(review),
    })),
    ...renewals.map((item) => ({
      dedupeKey: `subscription.renewal:${item.id}:${toIsoDate(item.renewsOn)}`,
      kind: "subscription.renewal",
      text: formatRenewalNotice({
        name: item.name,
        renewsOn: toIsoDate(item.renewsOn),
        overdue: item.renewsOn.getTime() < today.getTime(),
      }),
    })),
    ...latestFailures.map((run) => ({
      dedupeKey: `automation.failed:${run.id}`,
      kind: "automation.failed",
      text: formatAutomationFailure({
        jobName: run.job.name,
        detail: redact(run.error ?? run.summary).slice(0, 180),
      }),
    })),
  ];
}
