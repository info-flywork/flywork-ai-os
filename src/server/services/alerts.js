import "server-only";

import { can } from "@/server/auth/permissions";
import { dateOnly, istanbulToday, toIsoDate } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { redact } from "@/server/runtime/redact";
import { invoiceReviewMonthWhere } from "@/server/dashboard/summary";
import { TECHNOLOGY_DRAFTS } from "@/server/technology/drafts";

 







const LEAVE_LABELS = {
  ANNUAL: "Yıllık izin",
  SICK: "Rapor",
  EXCUSE: "Mazeret",
  UNPAID: "Ücretsiz izin",
};

function horizonDate(today) {
  return new Date(today.getTime() + 30 * 86_400_000);
}

export async function listAlerts(actor, now = new Date(), invoiceMonth) {
  const company = can(actor.role, "dashboard:company");
  const todayIso = istanbulToday(now);
  const today = dateOnly(todayIso);
  const horizon = horizonDate(today);

  const items = await withDatabase(async (db) => {
    const [reviews, leaves, renewals, failures] = await Promise.all([
      company
        ? db.invoiceReview.findMany({
            where: {
              status: "PENDING",
              documentType: { not: "STATEMENT" },
              ...(invoiceMonth ? invoiceReviewMonthWhere(invoiceMonth) : {}),
            },
            orderBy: { createdAt: "asc" },
            take: 30,
            select: { id: true, vendor: true, number: true, fileName: true },
          })
        : Promise.resolve([]),
      db.leaveRequest.findMany({
        where: { status: "PENDING", ...(company ? {} : { userId: actor.id }) },
        orderBy: { startDate: "asc" },
        take: 30,
        select: {
          id: true,
          type: true,
          startDate: true,
          user: { select: { name: true } },
        },
      }),
      company
        ? db.technologySubscription.findMany({
            where: { active: true, status: "ACTIVE", renewsOn: { lte: horizon } },
            orderBy: { renewsOn: "asc" },
            take: 20,
            select: { id: true, name: true, renewsOn: true },
          })
        : Promise.resolve([]),
      company
        ? db.automationRun.findMany({
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
          })
        : Promise.resolve([]),
    ]);

    const seenJobs = new Set();
    const latestFailures = failures.filter((run) => {
      if (seenJobs.has(run.jobId)) {
        return false;
      }
      seenJobs.add(run.jobId);
      return true;
    });

    const collected = [
      ...reviews.map((review) => ({
        key: `invoice.review:${review.id}`,
        title: "İnceleme bekleyen fatura",
        body: `${review.vendor || "Tedarikçi eksik"} · ${review.number || review.fileName}`,
        href: `/otomasyon/inceleme/${review.id}`,
      })),
      ...leaves.map((request) => ({
        key: `leave.request:${request.id}`,
        title: "Bekleyen izin talebi",
        body: `${company ? request.user.name : "Sizin talebiniz"} · ${LEAVE_LABELS[request.type] ?? request.type} · ${toIsoDate(request.startDate)}`,
        href: "/izin",
      })),
      ...renewals.map((item) => ({
        key: `subscription.renewal:${item.id}:${toIsoDate(item.renewsOn)}`,
        title: item.renewsOn.getTime() < today.getTime() ? "Geciken abonelik yenilemesi" : "Yaklaşan abonelik yenilemesi",
        body: `${item.name} · ${toIsoDate(item.renewsOn)}`,
        href: `/teknoloji?kayit=${item.id}`,
      })),
      ...latestFailures.map((run) => ({
        key: `automation.failed:${run.id}`,
        title: "Başarısız otomasyon",
        body: `${run.job.name} · ${redact(run.error ?? run.summary).slice(0, 180)}`,
        href: "/otomasyon",
      })),
      ...(company
        ? TECHNOLOGY_DRAFTS.map((draft) => ({
            key: `technology.draft:${draft.id}`,
            title: "Onay bekleyen hizmet taslağı",
            body: `${draft.name} · ${draft.known.join(". ")}. Eksik: ${draft.unknown.join(", ")}.`,
            href: `/teknoloji?taslak=${draft.id}`,
          }))
        : []),
    ];

    if (collected.length === 0) {
      return collected.map((item) => ({ ...item, read: false }));
    }
    const reads = await db.panelAlertRead.findMany({
      where: { userId: actor.id, dedupeKey: { in: collected.map((item) => item.key) } },
      select: { dedupeKey: true },
    });
    const readKeys = new Set(reads.map((row) => row.dedupeKey));
    return collected
      .map((item) => ({ ...item, read: readKeys.has(item.key) }))
      .sort((left, right) => Number(left.read) - Number(right.read));
  });

  return items;
}

export async function unreadAlertCount(actor, now = new Date()) {
  const alerts = await listAlerts(actor, now);
  return alerts.filter((alert) => !alert.read).length;
}

async function assertVisible(actor, key, now) {
  const alerts = await listAlerts(actor, now);
  if (!alerts.some((alert) => alert.key === key)) {
    throw new AppError("Bildirim bulunamadı.", "NOT_FOUND", 404);
  }
}

export async function markAlertRead(actor, key, now = new Date()) {
  await assertVisible(actor, key, now);
  await withDatabase((db) =>
    db.panelAlertRead.upsert({
      where: { userId_dedupeKey: { userId: actor.id, dedupeKey: key } },
      create: { userId: actor.id, dedupeKey: key },
      update: {},
    }),
  );
}

export async function markVisibleAlertsRead(actor, now = new Date()) {
  const alerts = await listAlerts(actor, now);
  if (alerts.length === 0) {
    return;
  }
  await withDatabase((db) =>
    db.panelAlertRead.createMany({
      data: alerts.map((alert) => ({ userId: actor.id, dedupeKey: alert.key })),
      skipDuplicates: true,
    }),
  );
}
