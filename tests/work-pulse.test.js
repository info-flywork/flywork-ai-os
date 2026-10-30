import { describe, expect, it } from "vitest";
import { buildWorkPulse, matchesWorkFilter } from "@/lib/workPulse";

const now = new Date("2026-10-30T12:00:00+03:00");
const today = "2026-10-30";

function task(partial) {
  return {
    id: partial.id,
    spaceId: "space",
    title: partial.title,
    column: partial.column,
    dueOn: partial.dueOn ?? null,
    assigneeIds: partial.assigneeIds ?? [],
    createdAt: "2026-10-01 09:00",
    revisions: partial.revisions ?? [],
    moves: partial.moves ?? [],
  };
}

function board(tasks) {
  return {
    today,
    spaces: [{ id: "space", name: "Lingola" }],
    people: [
      { id: "admin", name: "Tunahan", role: "ADMIN" },
      { id: "sena", name: "Sena", role: "EMPLOYEE" },
      { id: "emrah", name: "Emrah", role: "EMPLOYEE" },
    ],
    day: {
      roster: [
        { userId: "sena", current: { title: "Aulix ekranı" } },
        { userId: "emrah", current: null },
      ],
    },
    tasks,
  };
}

describe("görev özeti", () => {
  const tasks = [
    task({ id: "late", title: "Geç kalan", column: "DOING", dueOn: "2026-10-28", assigneeIds: ["sena"], moves: [{ column: "DOING", createdAt: "2026-10-20 09:00" }] }),
    task({ id: "done-late", title: "Bitmiş geç", column: "DONE", dueOn: "2026-10-01", assigneeIds: ["sena"], moves: [{ column: "DONE", createdAt: "2026-10-27 09:00" }] }),
    task({ id: "today", title: "Bugünkü", column: "DOING", dueOn: today, assigneeIds: ["emrah"] }),
    task({
      id: "review-old",
      title: "Eski kontrol",
      column: "REVIEW",
      dueOn: "2026-11-02",
      assigneeIds: ["sena"],
      moves: [{ column: "REVIEW", createdAt: "2026-10-28 10:00" }],
    }),
    task({
      id: "review-new",
      title: "Yeni kontrol",
      column: "REVIEW",
      dueOn: "2026-11-02",
      assigneeIds: ["emrah"],
      moves: [{ column: "REVIEW", createdAt: "2026-10-29 10:00" }],
    }),
    task({
      id: "revision",
      title: "Revize",
      column: "REVISION",
      dueOn: "2026-10-31",
      assigneeIds: ["emrah"],
      revisions: [{ done: false }, { done: true }, { done: false }],
    }),
    task({ id: "doing-2", title: "İkinci", column: "DOING", dueOn: "2026-11-01", assigneeIds: ["sena"] }),
    task({ id: "doing-3", title: "Üçüncü", column: "DOING", dueOn: "2026-11-03", assigneeIds: ["sena"] }),
    task({ id: "doing-4", title: "Dördüncü", column: "DOING", dueOn: "2026-11-04", assigneeIds: ["sena"] }),
  ];

  it("yönetici kartlarını ve bekleyiş sırasını kurar", () => {
    const pulse = buildWorkPulse({ id: "admin", role: "ADMIN" }, board(tasks), now);
    expect(pulse.counts.overdue).toBe(1);
    expect(pulse.counts.dueToday).toBe(1);
    expect(pulse.counts.review).toBe(2);
    expect(pulse.counts.revision).toBe(1);
    expect(pulse.reviewQueue.map((item) => item.id)).toEqual(["review-old", "review-new"]);
    expect(pulse.reviewQueue[0].tone).toBe("red");
    expect(pulse.reviewQueue[1].tone).toBe("orange");
    expect(pulse.overdueList[0]).toMatchObject({ id: "late", days: 2, column: "Yapılıyor", assignees: "Sena" });
    expect(pulse.team.find((person) => person.userId === "sena")).toMatchObject({
      current: "Aulix ekranı",
      doing: 4,
      overdue: 1,
      doneThisWeek: 1,
    });
    expect(pulse.team.find((person) => person.userId === "emrah").current).toBe("Boşta");
    expect(pulse.notices.some((item) => item.title.startsWith("İnceleme"))).toBe(false);
    expect(matchesWorkFilter(tasks[0], "geciken", today)).toBe(true);
    expect(matchesWorkFilter(tasks[1], "geciken", today)).toBe(false);
  });

  it("çalışana kendi açık ve revize kartlarını tarih sırasıyla verir", () => {
    const pulse = buildWorkPulse({ id: "emrah", role: "EMPLOYEE" }, board(tasks), now);
    expect(pulse.assigned.map((item) => item.id)).toEqual(["today", "revision", "review-new"]);
    expect(pulse.dueToday.map((item) => item.id)).toEqual(["today"]);
    expect(pulse.revision[0]).toMatchObject({ id: "revision", openItems: 2 });
  });
});
