import "server-only";

import { can } from "@/server/auth/permissions";
import { dateOnly, istanbulToday, toIsoDate } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { invalidate, remember } from "@/server/readCache";
import { AppError } from "@/server/errors";
import { redact } from "@/server/runtime/redact";
import { invoiceReviewMonthWhere } from "@/server/dashboard/summary";
import { isOwnCompanyName } from "@/server/finance/ownCompany";
import { alertSignature, applyAlertReads, buildAlerts, reviewWaitHours } from "@/lib/alertFeed";
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

  const items = await remember(`alerts:${actor.id}:${invoiceMonth ?? ""}:${todayIso}`, () => withDatabase(async (db) => {
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const [reviews, leaves, renewals, failures, successes, tasks, autoInvoices] = await Promise.all([
      company
        ? db.invoiceReview.findMany({
            where: {
              status: "PENDING",
              documentType: { not: "STATEMENT" },
              ...(invoiceMonth ? invoiceReviewMonthWhere(invoiceMonth) : {}),
            },
            orderBy: { createdAt: "asc" },
            take: 50,
            select: { id: true, vendor: true, number: true, fileName: true },
          })
        : Promise.resolve([]),
      company
        ? db.leaveRequest.findMany({
            where: { status: "PENDING" },
            orderBy: { startDate: "asc" },
            take: 30,
            select: {
              id: true,
              type: true,
              startDate: true,
              user: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
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
      company
        ? db.automationRun.findFirst({
            where: { state: "SUCCEEDED", job: { key: "invoice.daily" }, finishedAt: { gte: since } },
            orderBy: { finishedAt: "desc" },
            select: { id: true, summary: true, job: { select: { name: true } } },
          })
        : Promise.resolve(null),
      db.workTask.findMany({
        where: { column: { not: "DONE" } },
        select: {
          id: true,
          title: true,
          column: true,
          dueOn: true,
          revisionCount: true,
          createdById: true,
          assignees: { select: { userId: true, assignedAt: true } },
          moves: {
            where: { column: "REVIEW" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      }),
      company
        ? db.invoiceReviewAudit.findMany({
            where: { action: "AUTO_APPROVE", createdAt: { gte: since } },
            orderBy: { createdAt: "desc" },
            take: 30,
            select: { id: true, review: { select: { vendor: true, number: true } } },
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
    const incomingReviews = reviews.filter((review) => !isOwnCompanyName(review.vendor));
    const collected = buildAlerts({
      role: actor.role,
      userId: actor.id,
      today: todayIso,
      reviews: incomingReviews,
      leaves: leaves.map((request) => ({
        id: request.id,
        body: `${company ? request.user.name : "Sizin talebiniz"} · ${LEAVE_LABELS[request.type] ?? request.type} · ${toIsoDate(request.startDate)}`,
      })),
      renewals: renewals.map((item) => ({
        id: item.id,
        name: item.name,
        renewsOn: toIsoDate(item.renewsOn),
        overdue: item.renewsOn.getTime() < today.getTime(),
      })),
      failures: latestFailures.map((run) => ({
        id: run.id,
        name: run.job.name,
        detail: redact(run.error ?? run.summary).slice(0, 180),
      })),
      success: successes
        ? { id: successes.id, name: successes.job.name, detail: redact(successes.summary).slice(0, 180) }
        : null,
      drafts: company
        ? TECHNOLOGY_DRAFTS.map((draft) => ({
            id: draft.id,
            body: `${draft.name} · ${draft.known.join(". ")}. Eksik: ${draft.unknown.join(", ")}.`,
          }))
        : [],
      autoInvoices: autoInvoices.map((item) => ({
        id: item.id,
        body: `${item.review.vendor || "Tedarikçi"} · ${item.review.number || "numara yok"}`,
      })),
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        column: task.column,
        dueOn: task.dueOn ? toIsoDate(task.dueOn) : null,
        revisionCount: task.revisionCount,
        createdById: task.createdById,
        assigneeIds: task.assignees.map((item) => item.userId),
        assignedRecent: task.assignees.some((item) => item.userId === actor.id && item.assignedAt.getUTCFullYear() > 2020 && now.getTime() - item.assignedAt.getTime() < 14 * 86_400_000),
        reviewHours: reviewWaitHours(task.moves[0]?.createdAt, now),
      })),
    });

    if (collected.length === 0) {
      return collected.map((item) => ({ ...item, read: false }));
    }
    const reads = await db.panelAlertRead.findMany({
      where: { userId: actor.id, dedupeKey: { in: collected.map((item) => item.key) } },
      select: { dedupeKey: true, dismissed: true, signature: true },
    });
    return applyAlertReads(collected, reads);
  }));

  return items;
}

export async function unreadAlertCount(actor, now = new Date()) {
  const alerts = await listAlerts(actor, now);
  return alerts.filter((alert) => alert.level === "action" && !alert.read).length;
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
  invalidate("alerts");
}

export async function markVisibleAlertsRead(actor, now = new Date(), level = "action") {
  const alerts = await listAlerts(actor, now);
  const visible = alerts.filter((alert) => alert.level === level);
  if (visible.length === 0) {
    return;
  }
  await withDatabase((db) =>
    db.panelAlertRead.createMany({
      data: visible.map((alert) => ({ userId: actor.id, dedupeKey: alert.key })),
      skipDuplicates: true,
    }),
  );
  invalidate("alerts");
}

export async function dismissAlert(actor, key, now = new Date()) {
  const alerts = await listAlerts(actor, now);
  const alert = alerts.find((item) => item.key === key);
  if (!alert) {
    throw new AppError("Bildirim bulunamadı.", "NOT_FOUND", 404);
  }
  const signature = alertSignature(alert);
  await withDatabase((db) =>
    db.panelAlertRead.upsert({
      where: { userId_dedupeKey: { userId: actor.id, dedupeKey: key } },
      create: { userId: actor.id, dedupeKey: key, dismissed: true, signature },
      update: { dismissed: true, signature },
    }),
  );
  invalidate("alerts");
}

export async function dismissVisibleAlerts(actor, now = new Date(), level = "action") {
  const alerts = (await listAlerts(actor, now)).filter((alert) => alert.level === level);
  if (alerts.length === 0) {
    return;
  }
  await withDatabase(async (db) => {
    for (const alert of alerts) {
      const signature = alertSignature(alert);
      await db.panelAlertRead.upsert({
        where: { userId_dedupeKey: { userId: actor.id, dedupeKey: alert.key } },
        create: { userId: actor.id, dedupeKey: alert.key, dismissed: true, signature },
        update: { dismissed: true, signature },
      });
    }
  });
  invalidate("alerts");
}

export async function settleAlerts(userId, keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) {
    return;
  }
  await withDatabase((db) =>
    db.panelAlertRead.createMany({
      data: unique.map((key) => ({ userId, dedupeKey: key })),
      skipDuplicates: true,
    }),
  );
  invalidate("alerts");
}
