import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertCan, type Actor } from "@/server/auth/permissions";
import { assertNotMealOnly } from "@/server/auth/mealAccess";
import { randomBytes } from "node:crypto";
import { dateOnly, formatIstanbulDateTime, istanbulToday, toIsoDate } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { inspectWorkImage, readWorkImage, removeWorkImage, writeWorkImage } from "@/server/work/images";
import { pushWorkNotice, workAssignNotice, workCardNotice, workCommentNotice, workNoticeRecipients } from "@/server/work/notify";
import { moveWorkTaskSchema, parseInput, workCommentSchema, workCompletedSchema, workLinkSchema, workSpaceSchema, workTaskSchema } from "@/server/validation/schemas";

const COLUMNS = ["POOL", "DOING", "REVIEW", "REVISION", "DONE"] as const;
export type WorkColumnCode = (typeof COLUMNS)[number];
export type WorkPriorityCode = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type WorkTaskRow = {
  id: string;
  spaceId: string;
  title: string;
  detail: string;
  column: WorkColumnCode;
  priority: WorkPriorityCode;
  startsOn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  dueOn: string | null;
  completed: boolean;
  sortOrder: number;
  assigneeIds: string[];
  commentCount: number;
  comments: { id: string; authorName: string; body: string; createdAt: string }[];
  links: { id: string; url: string; label: string }[];
  images: { id: string }[];
};

function guard(actor: Actor, action: "task:read" | "task:write") {
  assertNotMealOnly(actor);
  assertCan(actor, action);
}

const assignableUser = {
  active: true,
  mealOnly: false,
};

export async function getWorkBoard(actor: Actor) {
  guard(actor, "task:read");
  return withDatabase(async (db) => {
    const [tasks, people, spaces] = await Promise.all([
      db.workTask.findMany({
        include: {
          assignees: { select: { userId: true } },
          comments: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
          links: { orderBy: { createdAt: "asc" } },
          images: { select: { id: true }, orderBy: { createdAt: "asc" } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      db.user.findMany({
        where: assignableUser,
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.workSpace.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
    ]);
    return {
      today: istanbulToday(),
      now: new Date().toISOString(),
      spaces,
      people,
      tasks: tasks.map((task): WorkTaskRow => ({
        id: task.id,
        spaceId: task.spaceId,
        title: task.title,
        detail: task.detail ?? "",
        column: task.column,
        priority: task.priority,
        startsOn: task.startsOn ? toIsoDate(task.startsOn) : null,
        startsAt: task.startsAt,
        endsAt: task.endsAt,
        dueOn: task.dueOn ? toIsoDate(task.dueOn) : null,
        completed: task.completed,
        sortOrder: task.sortOrder,
        assigneeIds: task.assignees.map((assignee) => assignee.userId),
        commentCount: task.comments.length,
        comments: task.comments.map((comment) => ({
          id: comment.id,
          authorName: comment.author.name,
          body: comment.body,
          createdAt: formatIstanbulDateTime(comment.createdAt),
        })),
        links: task.links.map((link) => ({ id: link.id, url: link.url, label: link.label || link.url })),
        images: task.images.map((image) => ({ id: image.id })),
      })),
    };
  });
}

async function eligibleIds(db: PrismaClient, ids: string[]) {
  const unique = [...new Set(ids)];
  const people = await db.user.findMany({
    where: { id: { in: unique }, ...assignableUser },
    select: { id: true },
  });
  if (people.length !== unique.length) {
    throw new AppError("Seçilen kişilerden biri iş listesinde değil.", "VALIDATION", 400);
  }
  return unique;
}

export async function createWorkSpace(actor: Actor, input: unknown) {
  guard(actor, "task:write");
  const data = parseInput(workSpaceSchema, input);
  const name = data.name.replace(/\s+/g, " ");
  return withDatabase(async (db) => {
    const existing = await db.workSpace.findMany({ select: { name: true, sortOrder: true } });
    if (existing.some((item) => item.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"))) {
      throw new AppError("Bu alan zaten var.", "CONFLICT", 409);
    }
    const sortOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
    return db.workSpace.create({ data: { name, sortOrder }, select: { id: true, name: true } });
  });
}

export async function saveWorkTask(actor: Actor, input: unknown) {
  guard(actor, "task:write");
  const data = parseInput(workTaskSchema, input);
  return withDatabase(async (db) => {
    const assigneeIds = await eligibleIds(db, data.assigneeIds);
    const payload = {
      title: data.title,
      detail: data.detail || null,
      column: data.column,
      priority: data.priority,
      startsOn: data.startsOn ? dateOnly(data.startsOn) : null,
      startsAt: data.startsAt || null,
      endsAt: data.endsAt || null,
      dueOn: data.dueOn ? dateOnly(data.dueOn) : null,
    };
    if (data.id) {
      const current = await db.workTask.findUnique({
        where: { id: data.id },
        select: { id: true, assignees: { select: { userId: true } } },
      });
      if (!current) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
      const previous = new Set(current.assignees.map((item) => item.userId));
      const added = workNoticeRecipients(assigneeIds.filter((id) => !previous.has(id)), actor.id);
      await db.workTaskAssignee.deleteMany({ where: { taskId: data.id } });
      const updated = await db.workTask.update({
        where: { id: data.id },
        data: { ...payload, assignees: { create: assigneeIds.map((userId) => ({ userId })) } },
      });
      await pushWorkNotice(db, {
        kind: "work.assign",
        eventId: `${updated.id}:${Date.now()}`,
        userIds: added,
        textFor: () => workAssignNotice(actor.name, data.title),
      });
      return updated;
    }
    if (!data.spaceId) {
      throw new AppError("Kartın alanı seçilmedi.", "VALIDATION", 400);
    }
    const space = await db.workSpace.findUnique({ where: { id: data.spaceId }, select: { id: true, name: true } });
    if (!space) throw new AppError("İş alanı bulunamadı.", "NOT_FOUND", 404);
    const last = await db.workTask.aggregate({ where: { spaceId: space.id, column: data.column }, _max: { sortOrder: true } });
    const created = await db.workTask.create({
      data: {
        ...payload,
        spaceId: space.id,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: actor.id,
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
      },
    });
    await pushWorkNotice(db, {
      kind: "work.open",
      eventId: created.id,
      userIds: workNoticeRecipients(assigneeIds, actor.id),
      textFor: () => workCardNotice(actor.name, `${space.name} · ${data.title}`),
    });
    return created;
  });
}

export async function moveWorkTask(actor: Actor, input: unknown) {
  guard(actor, "task:write");
  const data = parseInput(moveWorkTaskSchema, input);
  if (!data.orderedIds.includes(data.taskId)) {
    throw new AppError("Kart taşınamadı.", "VALIDATION", 400);
  }
  return withDatabase(async (db) => {
    const found = await db.workTask.findMany({ where: { id: { in: data.orderedIds } }, select: { id: true, column: true, spaceId: true } });
    if (found.length !== new Set(data.orderedIds).size) {
      throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
    }
    const current = found.find((item) => item.id === data.taskId);
    if (!current || found.some((item) => item.spaceId !== current.spaceId)) {
      throw new AppError("Kart yalnız kendi alanında taşınır.", "VALIDATION", 400);
    }
    const completed = data.column === "DONE" ? true : current?.column === "DONE" ? false : undefined;
    await db.$transaction([
      ...data.orderedIds.map((id, index) => db.workTask.update({
        where: { id },
        data: { column: data.column, sortOrder: index },
      })),
      ...(completed === undefined ? [] : [db.workTask.update({ where: { id: data.taskId }, data: { completed } })]),
    ]);
  });
}

export async function deleteWorkTask(actor: Actor, id: string) {
  guard(actor, "task:write");
  return withDatabase(async (db) => {
    const current = await db.workTask.findUnique({
      where: { id },
      select: { id: true, images: { select: { storageKey: true } } },
    });
    if (!current) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
    await db.workTask.delete({ where: { id } });
    await Promise.all(current.images.map((image) => removeWorkImage(image.storageKey)));
  });
}

function mentionedIds(body: string, people: { id: string; name: string }[]) {
  const lower = body.toLocaleLowerCase("tr");
  return people
    .filter((person) => lower.includes(`@${person.name.toLocaleLowerCase("tr")}`))
    .map((person) => person.id);
}

export async function setWorkTaskCompleted(actor: Actor, input: unknown) {
  guard(actor, "task:write");
  const data = parseInput(workCompletedSchema, input);
  return withDatabase(async (db) => {
    const current = await db.workTask.findUnique({ where: { id: data.id }, select: { id: true, column: true } });
    if (!current) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
    await db.workTask.update({
      where: { id: data.id },
      data: {
        completed: data.completed,
        column: !data.completed && current.column === "DONE" ? "DOING" : current.column,
      },
    });
  });
}

export async function addWorkComment(actor: Actor, input: unknown) {
  guard(actor, "task:write");
  const data = parseInput(workCommentSchema, input);
  return withDatabase(async (db) => {
    const task = await db.workTask.findUnique({
      where: { id: data.taskId },
      select: { id: true, title: true, assignees: { select: { userId: true } } },
    });
    if (!task) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
    const people = await db.user.findMany({
      where: assignableUser,
      select: { id: true, name: true },
    });
    const ids = mentionedIds(data.body, people);
    const comment = await db.workTaskComment.create({
      data: {
        taskId: data.taskId,
        authorId: actor.id,
        body: data.body,
        mentions: { create: ids.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    const mentioned = new Set(ids);
    await pushWorkNotice(db, {
      kind: "work.comment",
      eventId: comment.id,
      userIds: workNoticeRecipients([...task.assignees.map((item) => item.userId), ...ids], actor.id),
      textFor: (userId) => workCommentNotice({
        actor: actor.name,
        title: task.title,
        body: data.body,
        mentioned: mentioned.has(userId),
      }),
    });
  });
}

export async function addWorkLink(actor: Actor, input: unknown) {
  guard(actor, "task:write");
  const data = parseInput(workLinkSchema, input);
  return withDatabase(async (db) => {
    const task = await db.workTask.findUnique({ where: { id: data.taskId }, select: { id: true } });
    if (!task) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
    const count = await db.workTaskLink.count({ where: { taskId: data.taskId } });
    if (count >= 8) throw new AppError("Bir karta en fazla 8 link eklenebilir.", "VALIDATION", 400);
    await db.workTaskLink.create({
      data: { taskId: data.taskId, url: data.url, label: data.label || null },
    });
  });
}

export async function addWorkImage(actor: Actor, taskId: string, bytes: Buffer) {
  guard(actor, "task:write");
  const image = inspectWorkImage(bytes);
  const storageKey = randomBytes(16).toString("hex");
  return withDatabase(async (db) => {
    const task = await db.workTask.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
    const count = await db.workTaskImage.count({ where: { taskId } });
    if (count >= 6) throw new AppError("Bir karta en fazla 6 görsel eklenebilir.", "VALIDATION", 400);
    await writeWorkImage(storageKey, image.bytes);
    try {
      await db.workTaskImage.create({ data: { taskId, storageKey, contentType: image.contentType } });
    } catch (error) {
      await removeWorkImage(storageKey);
      throw error;
    }
  });
}

export async function deleteWorkLink(actor: Actor, id: string) {
  guard(actor, "task:write");
  return withDatabase(async (db) => {
    const current = await db.workTaskLink.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new AppError("Link bulunamadı.", "NOT_FOUND", 404);
    await db.workTaskLink.delete({ where: { id } });
  });
}

export async function deleteWorkImage(actor: Actor, id: string) {
  guard(actor, "task:write");
  return withDatabase(async (db) => {
    const current = await db.workTaskImage.findUnique({ where: { id }, select: { id: true, storageKey: true } });
    if (!current) throw new AppError("Görsel bulunamadı.", "NOT_FOUND", 404);
    await db.workTaskImage.delete({ where: { id } });
    await removeWorkImage(current.storageKey);
  });
}

export async function openWorkImage(actor: Actor, id: string) {
  guard(actor, "task:read");
  return withDatabase(async (db) => {
    const current = await db.workTaskImage.findUnique({ where: { id }, select: { storageKey: true, contentType: true } });
    if (!current) throw new AppError("Görsel bulunamadı.", "NOT_FOUND", 404);
    return { bytes: await readWorkImage(current.storageKey), contentType: current.contentType };
  });
}
