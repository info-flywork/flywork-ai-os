import "server-only";

import { buildWorkPulse } from "@/lib/workPulse";
import { formatMysqlDateTime, istanbulToday, toIsoDate } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { remember } from "@/server/readCache";
import { visibleWorkDay, workDayView } from "@/server/work/day";

export async function getWorkPulse(actor, now = new Date()) {
  const board = await loadPulseBoard(actor);
  const pulse = buildWorkPulse(actor, board, now);
  return actor.role === "ADMIN" ? { ...pulse, timeLog: board.timeLog ?? [] } : pulse;
}

async function loadPulseBoard(actor) {
  const board = await remember("work:pulse", () => withDatabase(async (db) => {
    const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const [tasks, people, spaces, sessions] = await Promise.all([
      db.workTask.findMany({
        where: { archived: false },
        select: {
          id: true,
          spaceId: true,
          title: true,
          column: true,
          priority: true,
          dueOn: true,
          createdAt: true,
          assignees: { select: { userId: true } },
          revisions: { select: { done: true } },
          moves: { select: { column: true, createdAt: true }, orderBy: { createdAt: "asc" } },
        },
      }),
      db.user.findMany({
        where: { active: true, mealOnly: false },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      }),
      db.workSpace.findMany({ select: { id: true, name: true } }),
      db.workSession.findMany({
        where: {
          OR: [
            { endedAt: null },
            { startedAt: { gte: since } },
            { endedAt: { gte: since } },
          ],
        },
        select: {
          userId: true,
          taskId: true,
          taskTitle: true,
          startedAt: true,
          pausedAt: true,
          endedAt: true,
          pausedMs: true,
          user: { select: { name: true } },
          task: { select: { title: true, spaceId: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 2000,
      }),
    ]);
    const today = istanbulToday();
    const day = workDayView(sessions.map((session) => ({
      userId: session.userId,
      userName: session.user.name,
      taskId: session.taskId,
      title: session.task?.title || session.taskTitle,
      spaceId: session.task?.spaceId ?? null,
      startedAt: session.startedAt,
      pausedAt: session.pausedAt,
      endedAt: session.endedAt,
    })), today);
    return {
      today,
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
        column: task.column,
        priority: task.priority,
        dueOn: task.dueOn ? toIsoDate(task.dueOn) : null,
        assigneeIds: task.assignees.map((assignee) => assignee.userId),
        createdAt: formatMysqlDateTime(task.createdAt),
        revisions: task.revisions,
        moves: task.moves.map((move) => ({
          column: move.column,
          createdAt: formatMysqlDateTime(move.createdAt),
        })),
      })),
    };
  }));
  return { ...board, day: visibleWorkDay(actor, board.people, board.day) };
}
