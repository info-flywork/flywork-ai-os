import "server-only";
import { assertCan } from "@/server/auth/permissions";
import { connectionReport } from "@/server/automation/connections";
import { runControlledInvoicePreview } from "@/server/finance/invoicePreview";
import { ensureAutomationJobs } from "@/server/automation/engine";
import { runInvoiceScan } from "@/server/automation/handlers";
import { formatIstanbul } from "@/server/automation/schedule";
import { withDatabase } from "@/server/db";
import { numberList, stringList } from "@/server/jsonList";
import { AppError } from "@/server/errors";
import { googleConnectionReport } from "@/server/finance/google";
import { readGoogleLink } from "@/server/google/account";
import { telegramStatus } from "@/server/telegram/config";

export async function getAutomationPage(actor) {
  assertCan(actor, "automation:read");
  return withDatabase(async (db) => {
    await ensureAutomationJobs(db, new Date());
    const link = await readGoogleLink(db);
    const telegramLink = await db.telegramLink.findUnique({
      where: { userId: actor.id },
      select: { revokedAt: true },
    });
    const [jobs, runs, notices, actions, statementCount, reviews] = await Promise.all([
      db.automationJob.findMany({ orderBy: [{ agent: "asc" }, { hour: "asc" }, { minute: "asc" }] }),
      db.automationRun.findMany({
        orderBy: { startedAt: "desc" },
        take: 30,
        include: { job: { select: { name: true, key: true } } },
      }),
      db.panelNotice.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
      db.agentActionRequest.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { decidedBy: { select: { name: true } } },
      }),
      db.invoiceReview.count({ where: { documentType: "STATEMENT" } }),
      db.invoiceReview.findMany({
        where: { documentType: { not: "STATEMENT" } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          vendor: true,
          number: true,
          missingFields: true,
          uncertainFields: true,
          archived: true,
          driveError: true,
        },
      }),
    ]);
    return {
      startCommand: "npm run automation:worker",
      google: googleConnectionReport(link),
      connections: connectionReport(link),
      jobs: jobs.map((job) => ({
        id: job.id,
        key: job.key,
        name: job.name,
        agent: job.agent,
        state: job.state,
        weekdays: numberList(job.weekdays),
        hour: job.hour,
        minute: job.minute,
        timezone: job.timezone,
        nextRunAt: formatIstanbul(job.nextRunAt),
        lastFinishedAt: job.lastFinishedAt ? formatIstanbul(job.lastFinishedAt) : null,
        lastSuccessAt: job.lastSuccessAt ? formatIstanbul(job.lastSuccessAt) : null,
        lastError: job.lastError,
        retryCount: job.retryCount,
        maxRetries: job.maxRetries,
      })),
      runs: runs.map((run) => ({
        id: run.id,
        jobKey: run.job.key,
        jobName: run.job.name,
        windowKey: run.windowKey,
        attempt: run.attempt,
        state: run.state,
        summary: run.summary,
        error: run.error,
        startedAt: formatIstanbul(run.startedAt),
      })),
      notices: notices.map((notice) => ({
        id: notice.id,
        title: notice.title,
        body: notice.body,
        channel: notice.channel,
        delivered: notice.delivered,
        createdAt: formatIstanbul(notice.createdAt),
      })),
      actions: actions.map((action) => ({
        id: action.id,
        kind: action.kind,
        state: action.state,
        summary: action.summary,
        decidedBy: action.decidedBy?.name ?? null,
        decisionNote: action.decisionNote,
      })),
      statementCount,
      invoiceReviews: reviews.map((review) => ({
        id: review.id,
        status: review.status,
        vendor: review.vendor,
        number: review.number,
        missingFields: stringList(review.missingFields),
        uncertainFields: stringList(review.uncertainFields),
        archived: review.archived,
        driveError: review.driveError,
      })),
      mailPreview: previewMail(runs.find((run) => run.job.key.startsWith("gmail."))?.report),
      invoicePreview: previewInvoice(runs.find((run) => run.job.key.startsWith("invoice."))?.report),
      invoiceRun: invoiceRunView(runs.find((run) => run.job.key.startsWith("invoice."))),
      telegram: {
        ...telegramStatus(),
        linked: Boolean(telegramLink && !telegramLink.revokedAt),
      },
    };
  });
}



function asItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, 15).flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item ;
    if (typeof row.messageId !== "string") {
      return [];
    }
    return [{
      messageId: row.messageId,
      from: typeof row.from === "string" ? row.from : "",
      subject: typeof row.subject === "string" ? row.subject : "",
      date: typeof row.date === "string" ? row.date : "",
    }];
  });
}

function previewMail(value) {
  if (!value || typeof value !== "object" || !("connected" in value) || value.connected !== true) {
    return null;
  }
  const row = value ;
  return {
    account: typeof row.account === "string" ? row.account : null,
    important: asItems(row.important),
    pendingReplies: asItems(row.pendingReplies),
    tasks: asItems(row.tasks),
  };
}

function invoiceRunView(run) {
  if (!run) {
    return null;
  }
  return {
    scannedAt: formatIstanbul(run.startedAt),
    state: run.state,
    summary: run.summary,
    error: run.error,
  };
}

function previewInvoice(value) {
  if (!value || typeof value !== "object" || !("connected" in value) || value.connected !== true) {
    return null;
  }
  const row = value ;
  const imported = Array.isArray(row.imported) ? row.imported.length : 0;
  const duplicates = Array.isArray(row.duplicates) ? row.duplicates.length : 0;
  const rejected = Array.isArray(row.rejected) ? row.rejected.length : 0;
  const errors = Array.isArray(row.errors)
    ? row.errors.filter((item) => typeof item === "string").slice(0, 5)
    : [];
  return {
    scannedAt: typeof row.scannedAt === "string" ? row.scannedAt : null,
    found: typeof row.found === "number" ? row.found : imported + duplicates + rejected,
    queued: typeof row.queued === "number" ? row.queued : imported,
    imported,
    duplicates,
    rejected,
    errors,
    driveUploaded: row.driveUploaded === true,
  };
}

export async function setAutomationJobState(actor, jobId, state) {
  assertCan(actor, "automation:write");
  const updated = await withDatabase((db) =>
    db.automationJob.updateMany({
      where: { id: jobId },
      data: { state },
    }),
  );
  if (updated.count !== 1) {
    throw new AppError("Görev bulunamadı.", "NOT_FOUND", 404);
  }
}

export async function decideAgentAction(
  actor,
  actionId,
  decision,
) {
  assertCan(actor, "automation:write");
  return withDatabase(async (db) => {
    const current = await db.agentActionRequest.findUnique({ where: { id: actionId } });
    if (!current || current.state !== "PENDING") {
      throw new AppError("Onay bekleyen işlem bulunamadı.", "NOT_FOUND", 404);
    }
    if (decision === "REJECTED") {
      await db.agentActionRequest.update({
        where: { id: current.id },
        data: {
          state: "REJECTED",
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: "Yönetici reddetti. E-posta gönderilmedi ve silinmedi.",
        },
      });
      return { state: "REJECTED"  };
    }
    await db.agentActionRequest.update({
      where: { id: current.id },
      data: {
        state: "BLOCKED",
        decidedById: actor.id,
        decidedAt: new Date(),
        decisionNote: "Gmail izni salt okunur. Onay kaydedildi, gönderme ve silme çalıştırılmadı.",
      },
    });
    return { state: "BLOCKED"  };
  });
}

export async function previewInvoiceReader(actor) {
  assertCan(actor, "automation:write");
  return withDatabase((db) => runControlledInvoicePreview(db));
}

export async function runGoogleJobNow(actor, key) {
  assertCan(actor, "automation:write");
  if (key !== "invoice.morning") {
    throw new AppError("Posta özeti kapalı. Yalnızca faturalar taranır.", "VALIDATION", 400);
  }
  return withDatabase(async (db) => {
    await ensureAutomationJobs(db, new Date());
    const job = await db.automationJob.findUnique({ where: { key } });
    if (!job) {
      throw new AppError("Görev bulunamadı.", "NOT_FOUND", 404);
    }
    const result = await runInvoiceScan(db);
    const now = new Date();
    await db.automationRun.create({
      data: {
        jobId: job.id,
        windowKey: `manual:${now.toISOString()}`,
        attempt: 1,
        state: result.state,
        startedAt: now,
        finishedAt: now,
        summary: result.summary,
        report: result.report ?? undefined,
        error: result.state === "WAITING_CONNECTION" ? result.summary : null,
      },
    });
    if (result.state === "SUCCEEDED" && job.state === "WAITING_CONNECTION") {
      await db.automationJob.update({
        where: { id: job.id },
        data: { state: "ACTIVE", lastSuccessAt: now, lastFinishedAt: now, lastError: null },
      });
    }
    if (result.state === "WAITING_CONNECTION") {
      await db.automationJob.update({
        where: { id: job.id },
        data: { lastFinishedAt: now, lastError: result.summary.slice(0, 500) },
      });
    }
    return { state: result.state, summary: result.summary };
  });
}
