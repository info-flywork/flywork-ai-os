import "server-only";

import { assertCan } from "@/server/auth/permissions";
import { assertNotMealOnly } from "@/server/auth/mealAccess";
import { randomBytes } from "node:crypto";
import { dateOnly, formatMysqlDateTime, istanbulToday, toIsoDate } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { invalidate, remember } from "@/server/readCache";
import { AppError } from "@/server/errors";
import { inspectWorkImage, readWorkImage, removeWorkImage, writeWorkImage } from "@/server/work/images";
import { workReplyCallback } from "@/server/telegram/messages";
import { visibleWorkDay, workDayView } from "@/server/work/day";
import { settleAlerts } from "@/server/services/alerts";
import { pauseGapMillis } from "@/lib/workTime";
import { unreadCommentCount } from "@/lib/workComments";
import { commentNoticeRecipients, pushWorkNotice, workAssignNotice, workCardNotice, workCommentNotice, workNoticeRecipients } from "@/server/work/notify";
import { moveWorkTaskSchema, parseInput, workCommentSchema, workCommentUpdateSchema, workCompletedSchema, workLinkSchema, workRevisionSchema, workSpaceSchema, workTaskSchema } from "@/server/validation/schemas";

const COLUMNS = ["POOL", "DOING", "REVIEW", "REVISION", "DONE"] ;
 






















function guard(actor, action) {
  assertNotMealOnly(actor);
  assertCan(actor, action);
}

const assignableUser = {
  active: true,
  mealOnly: false,
};

// Modül yenilenince eski pano önbelleği silinen gün kayıtlarını tutmasın.
invalidate("work:board");

export async function getWorkBoard(actor) {
  guard(actor, "task:read");
  const board = await remember("work:board", () => withDatabase(async (db) => {
    const [tasks, people, spaces, sessions] = await Promise.all([
      db.workTask.findMany({
        include: {
          assignees: { select: { userId: true } },
          createdBy: { select: { name: true } },
          comments: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
          links: { orderBy: { createdAt: "asc" } },
          images: { select: { id: true }, orderBy: { createdAt: "asc" } },
          revisions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
          moves: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      db.user.findMany({
        where: assignableUser,
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      }),
      db.workSpace.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
      db.workSession.findMany({
        where: {
          OR: [
            { endedAt: null },
            { startedAt: { gte: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000) } },
            { endedAt: { gte: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000) } },
          ],
        },
        include: { user: { select: { name: true } }, task: { select: { title: true, spaceId: true } } },
        orderBy: { startedAt: "desc" },
        take: 2000,
      }),
    ]);
    const today = istanbulToday();
    const day = workDayView(sessions.map((session) => ({
      id: session.id,
      userId: session.userId,
      userName: session.user.name,
      taskId: session.taskId,
      title: session.task?.title || session.taskTitle,
      spaceId: session.task?.spaceId ?? null,
      done: session.done,
      startedAt: session.startedAt,
      pausedAt: session.pausedAt,
      endedAt: session.endedAt,
    })), today);
    return {
      today,
      now: new Date().toISOString(),
      day: {
        now: day.now.map(({ startedAt, pausedAt, endedAt, ...item }) => item),
        paused: day.paused.map(({ startedAt, pausedAt, endedAt, ...item }) => item),
        earlier: day.earlier.map(({ startedAt, pausedAt, endedAt, ...item }) => item),
        log: day.log.map(({ startedAt, pausedAt, endedAt, ...item }) => item),
      },
      timeLog: sessions.map((session) => ({
        userId: session.userId,
        taskId: session.taskId,
        title: session.task?.title || session.taskTitle,
        start: session.startedAt.getTime(),
        stop: session.endedAt ? session.endedAt.getTime() : session.pausedAt ? session.pausedAt.getTime() : null,
        pausedMs: session.pausedMs ?? 0,
      })),
      spaces,
      people,
      tasks: tasks.map((task) => ({
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
        createdById: task.createdById,
        createdByName: task.createdBy.name,
        createdAt: formatMysqlDateTime(task.createdAt),
        commentCount: task.comments.length,
        comments: task.comments.map((comment) => ({
          id: comment.id,
          authorId: comment.authorId,
          authorName: comment.author.name,
          body: comment.body,
          createdAt: formatMysqlDateTime(comment.createdAt),
          at: comment.createdAt.toISOString(),
        })),
        links: task.links.map((link) => ({ id: link.id, url: link.url, label: link.label || link.url })),
        images: task.images.map((image) => ({ id: image.id })),
        enforced: task.enforced,
        revisionCount: task.revisionCount,
        revisions: task.revisions.map((item) => ({ id: item.id, body: item.body, done: item.done })),
        moves: task.moves.map((move) => ({
          id: move.id,
          column: move.column,
          actorName: move.actor.name,
          createdAt: formatMysqlDateTime(move.createdAt),
        })),
      })),
    };
  }));
  const day = visibleWorkDay(actor, board.people, board.day);
  const seenRows = await withDatabase((db) => db.workCardSeen.findMany({
    where: { userId: actor.id },
    select: { taskId: true, seenAt: true },
  }));
  const seenAt = new Map(seenRows.map((row) => [row.taskId, row.seenAt.getTime()]));
  const tasks = board.tasks.map((task) => ({
    ...task,
    comments: task.comments.map(({ at, ...comment }) => comment),
    unreadComments: unreadCommentCount(task.comments, actor.id, seenAt.get(task.id)),
  }));
  return { ...board, tasks, viewerId: actor.id, viewerRole: actor.role, day };
}

export async function seeWorkCard(actor, taskId) {
  guard(actor, "task:read");
  if (!taskId) return;
  await withDatabase(async (db) => {
    const task = await db.workTask.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) return;
    const seenAt = new Date();
    await db.workCardSeen.upsert({
      where: { userId_taskId: { userId: actor.id, taskId } },
      create: { userId: actor.id, taskId, seenAt },
      update: { seenAt },
    });
  });
}

async function eligibleIds(db, ids) {
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

const DOING_GATE = "Yapılıyor sütununa taşımak için sorumlu kişi ve teslim tarihi gerekli.";
const REVIEW_GATE = "Kontrol Ediliyor sütununa geçmek için revize maddelerinin hepsi işaretlenmeli.";
const FIELD_GATE = "Sorumlu kişi ve teslim tarihi gerekli.";

function cleanItems(items) {
  return (items ?? []).map((item) => item.trim()).filter(Boolean);
}

function assertDoingReady(dueOn, assigneeCount) {
  if (!dueOn || assigneeCount === 0) {
    throw new AppError(DOING_GATE, "VALIDATION", 400);
  }
}

function assertReviewReady(revisions) {
  if (revisions.some((item) => !item.done)) {
    throw new AppError(REVIEW_GATE, "VALIDATION", 400);
  }
}

function assertRevisionEntry(actor, items) {
  if (actor.role !== "ADMIN") {
    throw new AppError("Revize maddelerini yönetici girer.", "FORBIDDEN", 403);
  }
  if (items.length === 0) {
    throw new AppError("En az bir revize maddesi yazın.", "VALIDATION", 400);
  }
}

function assertManagerCloses(actor) {
  if (actor.role !== "ADMIN") {
    throw new AppError("Kartı yalnızca yönetici tamamlar.", "FORBIDDEN", 403);
  }
}

export async function createWorkSpace(actor, input) {
  invalidate("work");
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

export async function saveWorkTask(actor, input) {
  invalidate("work");
  invalidate("alerts");
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
    const items = cleanItems(data.items);
    if (data.id) {
      const current = await db.workTask.findUnique({
        where: { id: data.id },
        select: {
          id: true,
          column: true,
          enforced: true,
          assignees: { select: { userId: true, assignedAt: true } },
          revisions: { select: { done: true } },
        },
      });
      if (!current) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
      if (current.enforced && (assigneeIds.length === 0 || !data.dueOn)) {
        throw new AppError(FIELD_GATE, "VALIDATION", 400);
      }
      if (data.column === "DOING" && current.column !== "DOING") {
        assertDoingReady(data.dueOn, assigneeIds.length);
      }
      if (data.column === "REVIEW" && current.column !== "REVIEW") {
        assertReviewReady(current.revisions);
      }
      if (data.column === "REVISION" && current.column !== "REVISION") {
        assertRevisionEntry(actor, items);
      }
      if (data.column === "DONE" && current.column !== "DONE") {
        assertManagerCloses(actor);
      }
      const previous = new Map(current.assignees.map((item) => [item.userId, item.assignedAt]));
      const added = workNoticeRecipients(assigneeIds.filter((id) => !previous.has(id)));
      await db.workTaskAssignee.deleteMany({ where: { taskId: data.id } });
      const updated = await db.workTask.update({
        where: { id: data.id },
        data: {
          ...payload,
          assignees: {
            create: assigneeIds.map((userId) => ({ userId, assignedAt: previous.get(userId) ?? new Date() })),
          },
        },
      });
      if (data.column === "REVISION" && current.column !== "REVISION") {
        await addRevisionRound(db, data.id, items);
      }
      if (data.column !== current.column) {
        await db.workTaskMove.create({ data: { taskId: data.id, column: data.column, actorId: actor.id } });
      }
      await pushWorkNotice(db, {
        kind: "work.assign",
        eventId: `${updated.id}:${Date.now()}`,
        userIds: added,
        textFor: () => workAssignNotice(actor.name, data.title),
      });
      return updated;
    }
    if (assigneeIds.length === 0 || !data.dueOn) {
      throw new AppError(FIELD_GATE, "VALIDATION", 400);
    }
    if (data.column === "REVISION") {
      assertRevisionEntry(actor, items);
    }
    if (data.column === "DONE") {
      assertManagerCloses(actor);
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
        enforced: true,
        revisionCount: data.column === "REVISION" ? 1 : 0,
        spaceId: space.id,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: actor.id,
        assignees: { create: assigneeIds.map((userId) => ({ userId, assignedAt: new Date() })) },
        moves: { create: { column: data.column, actorId: actor.id } },
        ...(data.column === "REVISION" ? { revisions: { create: items.map((body, index) => ({ body, sortOrder: index })) } } : {}),
      },
    });
    await pushWorkNotice(db, {
      kind: "work.open",
      eventId: created.id,
      userIds: workNoticeRecipients(assigneeIds),
      textFor: () => workCardNotice(actor.name, `${space.name} · ${data.title}`),
    });
    return created;
  });
}

export async function moveWorkTask(actor, input) {
  invalidate("work");
  invalidate("alerts");
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
    const moving = await db.workTask.findUnique({
      where: { id: data.taskId },
      select: {
        column: true,
        dueOn: true,
        revisionCount: true,
        assignees: { select: { userId: true } },
        revisions: { select: { done: true, sortOrder: true } },
      },
    });
    if (!moving) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
    const items = cleanItems(data.items);
    const columnChanged = moving.column !== data.column;
    if (columnChanged && data.column === "DOING") {
      assertDoingReady(moving.dueOn, moving.assignees.length);
    }
    if (columnChanged && data.column === "REVIEW") {
      assertReviewReady(moving.revisions);
    }
    if (columnChanged && data.column === "REVISION") {
      assertRevisionEntry(actor, items);
    }
    if (columnChanged && data.column === "DONE") {
      assertManagerCloses(actor);
    }
    const completed = data.column === "DONE" ? true : current?.column === "DONE" ? false : undefined;
    if (data.column === "DONE") {
      await db.workSession.updateMany({
        where: { taskId: data.taskId, endedAt: null },
        data: { endedAt: new Date(), done: true },
      });
    }
    const nextSort = moving.revisions.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
    await db.$transaction([
      ...data.orderedIds.map((id, index) => db.workTask.update({
        where: { id },
        data: { column: data.column, sortOrder: index },
      })),
      ...(completed === undefined ? [] : [db.workTask.update({ where: { id: data.taskId }, data: { completed } })]),
      ...(columnChanged && data.column === "REVISION" ? [
        db.workTask.update({ where: { id: data.taskId }, data: { revisionCount: { increment: 1 } } }),
        ...items.map((body, index) => db.workRevisionItem.create({
          data: { taskId: data.taskId, body, sortOrder: nextSort + index },
        })),
      ] : []),
      ...(columnChanged ? [db.workTaskMove.create({ data: { taskId: data.taskId, column: data.column, actorId: actor.id } })] : []),
    ]);
    if (columnChanged) {
      const due = moving.dueOn ? toIsoDate(moving.dueOn) : "";
      const keys = [];
      if (moving.column === "REVIEW") {
        keys.push(`work.review:${data.taskId}`, `work.review.late:${data.taskId}`);
      }
      if (moving.column === "REVISION") {
        const revisionKey = `work.revision:${data.taskId}:${moving.revisionCount}`;
        keys.push(revisionKey);
        for (const person of moving.assignees) {
          await settleAlerts(person.userId, [revisionKey]);
        }
      }
      if (data.column === "DONE") {
        for (const person of moving.assignees) {
          const doneKeys = [`work.assigned:${data.taskId}:${person.userId}`];
          if (due) {
            doneKeys.push(`work.due24:${data.taskId}:${due}`, `work.overdue:${data.taskId}:${due}`);
          }
          await settleAlerts(person.userId, doneKeys);
        }
      }
      await settleAlerts(actor.id, keys);
      if (moving.column === "REVIEW") {
        const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
        for (const admin of admins) {
          if (admin.id !== actor.id) {
            await settleAlerts(admin.id, [`work.review:${data.taskId}`, `work.review.late:${data.taskId}`]);
          }
        }
      }
    }
  });
}

async function addRevisionRound(db, taskId, items) {
  const last = await db.workRevisionItem.aggregate({ where: { taskId }, _max: { sortOrder: true } });
  const nextSort = (last._max.sortOrder ?? -1) + 1;
  await db.$transaction([
    db.workTask.update({ where: { id: taskId }, data: { revisionCount: { increment: 1 } } }),
    ...items.map((body, index) => db.workRevisionItem.create({
      data: { taskId, body, sortOrder: nextSort + index },
    })),
  ]);
}

export async function setRevisionItem(actor, input) {
  invalidate("work");
  guard(actor, "task:write");
  const data = parseInput(workRevisionSchema, input);
  return withDatabase(async (db) => {
    const item = await db.workRevisionItem.findUnique({ where: { id: data.id }, select: { id: true } });
    if (!item) throw new AppError("Revize maddesi bulunamadı.", "NOT_FOUND", 404);
    await db.workRevisionItem.update({ where: { id: data.id }, data: { done: data.done } });
  });
}

export async function deleteWorkTask(actor, id) {
  invalidate("work");
  guard(actor, "task:write");
  if (actor.role !== "ADMIN") {
    throw new AppError("Kartı yalnızca yönetici silebilir.", "FORBIDDEN", 403);
  }
  return withDatabase(async (db) => {
    const current = await db.workTask.findUnique({
      where: { id },
      select: { id: true, images: { select: { storageKey: true } } },
    });
    if (!current) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
    await db.workSession.updateMany({
      where: { taskId: id, endedAt: null },
      data: { endedAt: new Date() },
    });
    await db.workTask.delete({ where: { id } });
    await Promise.all(current.images.map((image) => removeWorkImage(image.storageKey)));
  });
}

function mentionedIds(body, people) {
  const lower = body.toLocaleLowerCase("tr");
  return people
    .filter((person) => lower.includes(`@${person.name.toLocaleLowerCase("tr")}`))
    .map((person) => person.id);
}

export async function setWorkTaskCompleted(actor, input) {
  invalidate("work");
  guard(actor, "task:write");
  const data = parseInput(workCompletedSchema, input);
  assertManagerCloses(actor);
  return withDatabase(async (db) => {
    const current = await db.workTask.findUnique({
      where: { id: data.id },
      select: { id: true, column: true, dueOn: true, assignees: { select: { userId: true } } },
    });
    if (!current) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
    const nextColumn = !data.completed && current.column === "DONE" ? "DOING" : current.column;
    if (nextColumn === "DOING" && current.column !== "DOING") {
      assertDoingReady(current.dueOn, current.assignees.length);
    }
    await db.workTask.update({
      where: { id: data.id },
      data: {
        completed: data.completed,
        column: nextColumn,
      },
    });
    if (nextColumn !== current.column) {
      await db.workTaskMove.create({ data: { taskId: data.id, column: nextColumn, actorId: actor.id } });
    }
    if (data.completed) {
      await db.workSession.updateMany({
        where: { taskId: data.id, endedAt: null },
        data: { endedAt: new Date(), done: true },
      });
    }
  });
}

export async function setWorkFocus(actor, taskId) {
  invalidate("work");
  guard(actor, "task:write");
  return withDatabase(async (db) => {
    const open = await db.workSession.findMany({
      where: { userId: actor.id, endedAt: null },
      select: { id: true, taskId: true, pausedAt: true, pausedMs: true },
    });
    const running = open.find((item) => !item.pausedAt);
    if (!taskId) {
      if (running) {
        await db.workSession.update({ where: { id: running.id }, data: { pausedAt: new Date() } });
      }
      return running ? "paused" : "idle";
    }
    const same = open.find((item) => item.taskId === taskId);
    if (same && !same.pausedAt) {
      await db.workSession.update({ where: { id: same.id }, data: { pausedAt: new Date() } });
      return "paused";
    }
    const task = await db.workTask.findUnique({
      where: { id: taskId },
      select: { id: true, title: true, completed: true, column: true },
    });
    if (!task) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
    if (task.completed || task.column === "DONE") {
      throw new AppError("Tamamlanan kart şu anki iş olarak seçilemez.", "VALIDATION", 400);
    }
    if (running && running.id !== same?.id) {
      await db.workSession.update({ where: { id: running.id }, data: { pausedAt: new Date() } });
    }
    if (same) {
      await db.workSession.update({
        where: { id: same.id },
        data: { pausedAt: null, pausedMs: (same.pausedMs ?? 0) + pauseGapMillis(same.pausedAt) },
      });
      return "resumed";
    }
    await db.workSession.create({
      data: { userId: actor.id, taskId: task.id, taskTitle: task.title.slice(0, 255) },
    });
    return "started";
  });
}

export async function finishWorkSession(actor, taskId) {
  invalidate("work");
  guard(actor, "task:write");
  if (!taskId) throw new AppError("Bitirilecek iş yok.", "VALIDATION", 400);
  return withDatabase(async (db) => {
    const open = await db.workSession.findFirst({
      where: { userId: actor.id, taskId, endedAt: null },
      select: { id: true, pausedAt: true, pausedMs: true },
    });
    if (!open) throw new AppError("Bitirilecek çalışan iş yok.", "NOT_FOUND", 404);
    await db.workSession.update({
      where: { id: open.id },
      data: {
        endedAt: new Date(),
        pausedAt: null,
        pausedMs: (open.pausedMs ?? 0) + pauseGapMillis(open.pausedAt),
        done: true,
      },
    });
  });
}

export async function addWorkComment(actor, input) {
  invalidate("work");
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
      userIds: commentNoticeRecipients(task.assignees.map((item) => item.userId), ids, actor.id),
      textFor: (userId) => workCommentNotice({
        actor: actor.name,
        title: task.title,
        body: data.body,
        mentioned: mentioned.has(userId),
      }),
      buttons: [[{ text: "Cevapla", data: workReplyCallback(task.id) }]],
    });
  });
}

export async function updateWorkComment(actor, input) {
  invalidate("work");
  guard(actor, "task:write");
  const data = parseInput(workCommentUpdateSchema, input);
  return withDatabase(async (db) => {
    const current = await db.workTaskComment.findUnique({
      where: { id: data.id },
      select: { id: true, authorId: true },
    });
    if (!current) throw new AppError("Yorum bulunamadı.", "NOT_FOUND", 404);
    if (current.authorId !== actor.id) throw new AppError("Yalnızca kendi yorumunu düzenleyebilirsin.", "FORBIDDEN", 403);
    const people = await db.user.findMany({
      where: assignableUser,
      select: { id: true, name: true },
    });
    const ids = mentionedIds(data.body, people);
    await db.workTaskComment.update({
      where: { id: current.id },
      data: {
        body: data.body,
        mentions: { deleteMany: {}, create: ids.map((userId) => ({ userId })) },
      },
    });
  });
}

export async function addWorkLink(actor, input) {
  invalidate("work");
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

export async function addWorkImage(actor, taskId, bytes) {
  invalidate("work");
  guard(actor, "task:write");
  const image = inspectWorkImage(bytes);
  const storageKey = randomBytes(16).toString("hex");
  return withDatabase(async (db) => {
    const task = await db.workTask.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) throw new AppError("Kart bulunamadı.", "NOT_FOUND", 404);
    const count = await db.workTaskImage.count({ where: { taskId } });
    if (count >= 20) throw new AppError("Bir karta en fazla 20 görsel eklenebilir.", "VALIDATION", 400);
    await writeWorkImage(storageKey, image.bytes);
    try {
      await db.workTaskImage.create({ data: { taskId, storageKey, contentType: image.contentType } });
    } catch (error) {
      await removeWorkImage(storageKey);
      throw error;
    }
  });
}

export async function deleteWorkLink(actor, id) {
  invalidate("work");
  guard(actor, "task:write");
  return withDatabase(async (db) => {
    const current = await db.workTaskLink.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw new AppError("Link bulunamadı.", "NOT_FOUND", 404);
    await db.workTaskLink.delete({ where: { id } });
  });
}

export async function deleteWorkImage(actor, id) {
  invalidate("work");
  guard(actor, "task:write");
  if (actor.role !== "ADMIN") {
    throw new AppError("Görseli yalnızca yönetici silebilir.", "FORBIDDEN", 403);
  }
  return withDatabase(async (db) => {
    const current = await db.workTaskImage.findUnique({ where: { id }, select: { id: true, storageKey: true } });
    if (!current) throw new AppError("Görsel bulunamadı.", "NOT_FOUND", 404);
    await db.workTaskImage.delete({ where: { id } });
    await removeWorkImage(current.storageKey);
  });
}

export async function openWorkImage(actor, id) {
  guard(actor, "task:read");
  return withDatabase(async (db) => {
    const current = await db.workTaskImage.findUnique({ where: { id }, select: { storageKey: true, contentType: true } });
    if (!current) throw new AppError("Görsel bulunamadı.", "NOT_FOUND", 404);
    return { bytes: await readWorkImage(current.storageKey), contentType: current.contentType };
  });
}
