import "server-only";
import { assertNotMealOnly } from "@/server/auth/mealAccess";
import { assertCan, type Actor } from "@/server/auth/permissions";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { notifyFeedback } from "@/server/telegram/feedbackPush";
import { feedbackReviewSchema, feedbackSchema, parseInput } from "@/server/validation/schemas";

const KIND_LABEL = {
  SUGGESTION: "Öneri",
  COMPLAINT: "Şikayet",
} as const;

const STATUS_LABEL = {
  OPEN: "İletildi",
  REVIEWED: "İncelendi",
} as const;

function whenLabel(value: Date) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export async function listFeedback(actor: Actor) {
  assertCan(actor, "feedback:read");
  return withDatabase(async (db) => {
    const rows = await db.feedbackNote.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        kind: true,
        body: true,
        status: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });
    return {
      admin: true,
      notes: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        kindLabel: KIND_LABEL[row.kind],
        body: row.body,
        status: row.status,
        statusLabel: STATUS_LABEL[row.status],
        createdAt: whenLabel(row.createdAt),
        authorName: row.user.name,
      })),
    };
  });
}

export async function createFeedback(actor: Actor, input: unknown) {
  assertCan(actor, "feedback:create");
  assertNotMealOnly(actor);
  const data = parseInput(feedbackSchema, input);
  const created = await withDatabase((db) =>
    db.feedbackNote.create({
      data: {
        userId: actor.id,
        kind: data.kind,
        body: data.body,
      },
      select: { id: true },
    }),
  );
  await notifyFeedback(created.id);
  return created;
}

export async function deleteFeedback(actor: Actor, input: unknown) {
  assertCan(actor, "feedback:review");
  const data = parseInput(feedbackReviewSchema, input);
  return withDatabase(async (db) => {
    const note = await db.feedbackNote.findUnique({
      where: { id: data.id },
      select: { id: true },
    });
    if (!note) {
      throw new AppError("Kayıt bulunamadı.", "NOT_FOUND", 404);
    }
    await db.feedbackNote.delete({ where: { id: note.id } });
    return { id: note.id };
  });
}

export async function reviewFeedback(actor: Actor, input: unknown) {
  assertCan(actor, "feedback:review");
  const data = parseInput(feedbackReviewSchema, input);
  return withDatabase(async (db) => {
    const note = await db.feedbackNote.findUnique({
      where: { id: data.id },
      select: { id: true, status: true },
    });
    if (!note) {
      throw new AppError("Kayıt bulunamadı.", "NOT_FOUND", 404);
    }
    if (note.status === "REVIEWED") {
      return note;
    }
    return db.feedbackNote.update({
      where: { id: note.id },
      data: {
        status: "REVIEWED",
        reviewedAt: new Date(),
        reviewedById: actor.id,
      },
      select: { id: true },
    });
  });
}
