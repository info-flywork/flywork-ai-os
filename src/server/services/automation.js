import "server-only";
import { randomBytes } from "node:crypto";
import { assertCan } from "@/server/auth/permissions";
import { connectionReport } from "@/server/automation/connections";
import { runControlledInvoicePreview } from "@/server/finance/invoicePreview";
import { isOwnCompanyName } from "@/server/finance/ownCompany";
import { ensureAutomationJobs, JOB_COOLDOWN_MS, JOB_LOCK_MS } from "@/server/automation/engine";
import { runInvoiceScan } from "@/server/automation/handlers";
import { formatDuration, formatIstanbul, nextOccurrence } from "@/server/automation/schedule";
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
        finishedAt: run.finishedAt ? formatIstanbul(run.finishedAt) : null,
        duration: formatDuration(run.startedAt, run.finishedAt),
        stats: runStats(run.report),
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
      invoiceReviews: reviews.filter((review) => !isOwnCompanyName(review.vendor)).map((review) => ({
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



function runStats(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value;
  const committed = Array.isArray(row.processed) ? row.processed.length : 0;
  const queued = typeof row.queued === "number" ? row.queued : 0;
  const errors = Array.isArray(row.errors) ? row.errors.length : 0;
  if (typeof row.found !== "number" && !Array.isArray(row.processed)) {
    return null;
  }
  return {
    found: typeof row.found === "number" ? row.found : 0,
    processed: committed + queued,
    skipped: typeof row.skipped === "number"
      ? row.skipped
      : Array.isArray(row.duplicates) ? row.duplicates.length : 0,
    errors,
  };
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
  const committed = Array.isArray(row.processed) ? row.processed.length : 0;
  const duplicates = Array.isArray(row.duplicates) ? row.duplicates.length : 0;
  const rejected = Array.isArray(row.rejected) ? row.rejected.length : 0;
  const errors = Array.isArray(row.errors)
    ? row.errors.filter((item) => typeof item === "string").slice(0, 5)
    : [];
  return {
    scannedAt: typeof row.scannedAt === "string" ? row.scannedAt : null,
    found: typeof row.found === "number" ? row.found : imported + duplicates + rejected,
    queued: typeof row.queued === "number" ? row.queued : imported,
    processed: committed + (typeof row.queued === "number" ? row.queued : imported),
    imported,
    duplicates,
    skipped: typeof row.skipped === "number" ? row.skipped : 0,
    outgoing: typeof row.outgoing === "number" ? row.outgoing : 0,
    rejected,
    errors,
    driveUploaded: row.driveUploaded === true,
  };
}

export async function setInvoiceScanSchedule(actor, jobId, hour, minute) {
  assertCan(actor, "automation:write");
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new AppError("Saat 00:00 ile 23:59 arasında olmalı.", "VALIDATION", 400);
  }
  return withDatabase(async (db) => {
    const job = await db.automationJob.findUnique({ where: { id: jobId } });
    if (!job || job.key !== "invoice.daily") {
      throw new AppError("Günlük fatura taraması bulunamadı.", "NOT_FOUND", 404);
    }
    const now = new Date();
    if (job.lockToken && job.lockedUntil && job.lockedUntil > now) {
      return { ok: false, code: "kilit" };
    }
    const slot = nextOccurrence({ weekdays: [], hour, minute }, now);
    await db.automationJob.update({
      where: { id: job.id },
      data: { hour, minute, nextRunAt: slot, scheduledFor: slot },
    });
    return { ok: true };
  });
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
  if (key !== "invoice.daily") {
    throw new AppError("Posta özeti kapalı. Yalnızca faturalar taranır.", "VALIDATION", 400);
  }
  return withDatabase(async (db) => {
    await ensureAutomationJobs(db, new Date());
    const job = await db.automationJob.findUnique({ where: { key } });
    if (!job) {
      throw new AppError("Görev bulunamadı.", "NOT_FOUND", 404);
    }
    const now = new Date();
    if (job.lockToken && job.lockedUntil && job.lockedUntil > now) {
      console.info(`Otomasyon atlandı (${job.key}): aynı görev zaten çalışıyor.`);
      return { state: "SUCCEEDED", summary: "Fatura taraması zaten çalışıyor. Yeni çalışma atlandı." };
    }
    if (job.lastSuccessAt && now.getTime() - job.lastSuccessAt.getTime() < JOB_COOLDOWN_MS) {
      console.info(`Otomasyon atlandı (${job.key}): son 5 dakika içinde çalıştı.`);
      return { state: "SUCCEEDED", summary: "Fatura taraması son 5 dakika içinde çalıştı. Yeni çalışma atlandı." };
    }
    const token = randomBytes(16).toString("hex");
    const claimed = await db.automationJob.updateMany({
      where: {
        id: job.id,
        OR: [{ lockToken: null }, { lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: {
        lockToken: token,
        lockedUntil: new Date(now.getTime() + JOB_LOCK_MS),
        lastStartedAt: now,
      },
    });
    if (claimed.count !== 1) {
      console.info(`Otomasyon atlandı (${job.key}): aynı görev zaten çalışıyor.`);
      return { state: "SUCCEEDED", summary: "Fatura taraması zaten çalışıyor. Yeni çalışma atlandı." };
    }
    const started = new Date();
    try {
      const result = await runInvoiceScan(db);
      const finished = new Date();
      await db.automationRun.create({
        data: {
          jobId: job.id,
          windowKey: `manual:${started.toISOString()}`,
          attempt: 1,
          state: result.state,
          startedAt: started,
          finishedAt: finished,
          summary: result.summary,
          report: result.report ?? undefined,
          error: result.state === "WAITING_CONNECTION" ? result.summary : null,
        },
      });
      await db.automationJob.updateMany({
        where: { id: job.id, lockToken: token },
        data: {
          lockToken: null,
          lockedUntil: null,
          lastFinishedAt: finished,
          ...(result.state === "SUCCEEDED"
            ? {
                state: "ACTIVE",
                lastSuccessAt: finished,
                lastError: null,
              }
            : { lastError: result.summary.slice(0, 500) }),
        },
      });
      return { state: result.state, summary: result.summary };
    } catch (error) {
      await db.automationJob.updateMany({
        where: { id: job.id, lockToken: token },
        data: { lockToken: null, lockedUntil: null },
      });
      throw error;
    }
  });
}
