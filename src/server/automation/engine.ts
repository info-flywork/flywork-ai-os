import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { JOB_DEFINITIONS } from "@/server/automation/catalog";
import { JOB_HANDLERS, type JobResult } from "@/server/automation/handlers";
import { nextOccurrence, retryDelayMs, weekdayOf, windowKeyFromInstant, type JobSchedule } from "@/server/automation/schedule";
import { numberList } from "@/server/jsonList";

type Db = PrismaClient;
type Handler = (db: Db, now: Date) => Promise<JobResult>;

export type TickResult = "idle" | "executed" | "advanced";

type TickOptions = {
  handlers?: Record<string, Handler>;
  retryDelayMs?: (attempt: number) => number;
};

const LOCK_MS = 2 * 60 * 1000;

function scheduleOf(job: { weekdays: unknown; hour: number; minute: number }): JobSchedule {
  return { weekdays: numberList(job.weekdays), hour: job.hour, minute: job.minute };
}

function slotMatches(instant: Date, definition: JobSchedule) {
  const [date, clock] = windowKeyFromInstant(instant).split("T");
  const expected = `${String(definition.hour).padStart(2, "0")}:${String(definition.minute).padStart(2, "0")}`;
  return clock === expected && (definition.weekdays.length === 0 || definition.weekdays.includes(weekdayOf(date)));
}

function sameSchedule(
  left: { weekdays: unknown; hour: number; minute: number },
  right: { weekdays: number[]; hour: number; minute: number },
) {
  const days = numberList(left.weekdays);
  return (
    left.hour === right.hour &&
    left.minute === right.minute &&
    days.length === right.weekdays.length &&
    days.every((day, index) => day === right.weekdays[index])
  );
}

export async function ensureAutomationJobs(db: Db, now = new Date()) {
  for (const definition of JOB_DEFINITIONS) {
    const existing = await db.automationJob.findUnique({ where: { key: definition.key } });
    if (!existing) {
      const slot = nextOccurrence(definition, now);
      await db.automationJob.create({
        data: {
          key: definition.key,
          name: definition.name,
          agent: definition.agent,
          timezone: "Europe/Istanbul",
          weekdays: definition.weekdays,
          hour: definition.hour,
          minute: definition.minute,
          state: definition.paused ? "PAUSED" : definition.initialState,
          nextRunAt: slot,
          scheduledFor: slot,
          maxRetries: 3,
        },
      });
      continue;
    }
    const locked = Boolean(existing.lockedUntil && existing.lockedUntil > now);
    const moved = !sameSchedule(existing, definition) || !slotMatches(existing.nextRunAt, definition);
    const slot = !locked && moved ? nextOccurrence(definition, now) : null;
    await db.automationJob.update({
      where: { id: existing.id },
      data: {
        name: definition.name,
        agent: definition.agent,
        weekdays: definition.weekdays,
        hour: definition.hour,
        minute: definition.minute,
        ...(definition.paused ? { state: "PAUSED" as const } : {}),
        ...(slot ? { nextRunAt: slot, scheduledFor: slot, retryCount: 0, lockToken: null, lockedUntil: null } : {}),
      },
    });
  }
}

export async function runDueJob(db: Db, now = new Date(), options: TickOptions = {}): Promise<TickResult> {
  const handlers = options.handlers ?? JOB_HANDLERS;
  const delayFor = options.retryDelayMs ?? retryDelayMs;
  const claim = await claimJob(db, now);
  if (!claim) {
    return "idle";
  }
  if (claim.kind === "advanced") {
    return "advanced";
  }

  let result: JobResult;
  try {
    const handler = handlers[claim.job.key];
    if (!handler) {
      throw new Error(`Görev işleyicisi yok: ${claim.job.key}`);
    }
    result = await handler(db, now);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Görev tamamlanamadı.";
    await finishFailure(db, claim, now, message, delayFor);
    return "executed";
  }
  await finishSuccess(db, claim, now, result);
  return "executed";
}

export async function drainDueJobs(db: Db, now = new Date(), options: TickOptions = {}): Promise<number> {
  let count = 0;
  for (;;) {
    const result = await runDueJob(db, now, options);
    if (result === "idle") {
      return count;
    }
    count += 1;
    if (count >= 50) {
      return count;
    }
  }
}

type Claimed = {
  kind: "run";
  job: {
    id: string;
    key: string;
    weekdays: number[];
    hour: number;
    minute: number;
    maxRetries: number;
    scheduledFor: Date;
  };
  runId: string;
  lockToken: string;
  attempt: number;
};

async function claimJob(db: Db, now: Date): Promise<Claimed | { kind: "advanced" } | null> {
  return db.$transaction(async (tx) => {
    const due = await tx.automationJob.findFirst({
      where: {
        state: { in: ["ACTIVE", "WAITING_CONNECTION"] },
        nextRunAt: { lte: now },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      orderBy: { nextRunAt: "asc" },
    });
    if (!due) {
      return null;
    }
    const lockName = `job:${due.id}`.slice(0, 64);
    const locked = await tx.$queryRaw<Array<{ locked: unknown }>>`SELECT GET_LOCK(${lockName}, 15) AS locked`;
    if (Number(locked[0]?.locked) !== 1) {
      return null;
    }
    try {
    const job = await tx.automationJob.findUnique({ where: { id: due.id } });
    if (!job || job.state === "PAUSED" || job.nextRunAt > now) {
      return null;
    }
    if (job.lockedUntil && job.lockedUntil > now && job.lockToken) {
      return null;
    }

    const windowKey = windowKeyFromInstant(job.scheduledFor);
    const existing = await tx.automationRun.findUnique({
      where: { jobId_windowKey: { jobId: job.id, windowKey } },
    });
    const finished =
      existing?.state === "SUCCEEDED" || existing?.state === "WAITING_CONNECTION";
    const exhausted = existing?.state === "FAILED" && job.retryCount >= job.maxRetries;
    if (finished || exhausted || (existing?.state === "FAILED" && existing.attempt >= job.maxRetries)) {
      const slot = nextOccurrence(scheduleOf(job), job.scheduledFor);
      await tx.automationJob.update({
        where: { id: job.id },
        data: {
          nextRunAt: slot,
          scheduledFor: slot,
          retryCount: 0,
          lockToken: null,
          lockedUntil: null,
        },
      });
      return { kind: "advanced" };
    }

    const lockToken = randomBytes(16).toString("hex");
    const attempt = (existing?.attempt ?? 0) + 1;
    await tx.automationJob.update({
      where: { id: job.id },
      data: {
        lockToken,
        lockedUntil: new Date(now.getTime() + LOCK_MS),
        lastStartedAt: now,
      },
    });
    const run = existing
      ? await tx.automationRun.update({
          where: { id: existing.id },
          data: {
            state: "RUNNING",
            attempt,
            startedAt: now,
            finishedAt: null,
            error: null,
            summary: "Çalışıyor",
          },
        })
      : await tx.automationRun.create({
          data: {
            jobId: job.id,
            windowKey,
            attempt,
            state: "RUNNING",
            startedAt: now,
            summary: "Çalışıyor",
          },
        });
    return {
      kind: "run" as const,
      job: {
        id: job.id,
        key: job.key,
        weekdays: numberList(job.weekdays),
        hour: job.hour,
        minute: job.minute,
        maxRetries: job.maxRetries,
        scheduledFor: job.scheduledFor,
      },
      runId: run.id,
      lockToken,
      attempt,
    };
    } finally {
      await tx.$queryRaw`SELECT RELEASE_LOCK(${lockName})`;
    }
  });
}

async function stillOwns(tx: Prisma.TransactionClient, claim: Claimed) {
  const job = await tx.automationJob.findUnique({ where: { id: claim.job.id } });
  return Boolean(job && job.lockToken === claim.lockToken);
}

async function finishSuccess(db: Db, claim: Claimed, now: Date, result: JobResult) {
  const slot = nextOccurrence(scheduleOf(claim.job), claim.job.scheduledFor);
  await db.$transaction(async (tx) => {
    if (!(await stillOwns(tx, claim))) {
      return;
    }
    await tx.automationRun.update({
      where: { id: claim.runId },
      data: {
        state: result.state,
        finishedAt: now,
        summary: result.summary.slice(0, 2000),
        report: result.report ?? undefined,
        error: null,
      },
    });
    const current = await tx.automationJob.findUnique({ where: { id: claim.job.id } });
    await tx.automationJob.update({
      where: { id: claim.job.id },
      data: {
        state:
          current?.state === "PAUSED"
            ? "PAUSED"
            : result.state === "WAITING_CONNECTION"
              ? "WAITING_CONNECTION"
              : "ACTIVE",
        nextRunAt: slot,
        scheduledFor: slot,
        lastFinishedAt: now,
        lastSuccessAt: result.state === "SUCCEEDED" ? now : undefined,
        lastError: result.state === "WAITING_CONNECTION" ? result.summary.slice(0, 500) : null,
        retryCount: 0,
        lockToken: null,
        lockedUntil: null,
      },
    });
  });
}

async function finishFailure(
  db: Db,
  claim: Claimed,
  now: Date,
  message: string,
  delayFor: (attempt: number) => number,
) {
  const giveUp = claim.attempt >= claim.job.maxRetries;
  const slot = giveUp ? nextOccurrence(scheduleOf(claim.job), claim.job.scheduledFor) : null;
  await db.$transaction(async (tx) => {
    if (!(await stillOwns(tx, claim))) {
      return;
    }
    await tx.automationRun.update({
      where: { id: claim.runId },
      data: {
        state: "FAILED",
        finishedAt: now,
        error: message,
        summary: message,
      },
    });
    await tx.automationJob.update({
      where: { id: claim.job.id },
      data: {
        lastFinishedAt: now,
        lastError: message,
        retryCount: giveUp ? 0 : claim.attempt,
        nextRunAt: slot ?? new Date(now.getTime() + delayFor(claim.attempt)),
        scheduledFor: slot ?? claim.job.scheduledFor,
        lockToken: null,
        lockedUntil: null,
      },
    });
  });
}
