export const WORK_FILTERS = {
  geciken: "Geciken işler",
  bugun: "Bugün teslim",
  kontrol: "Kontrolümü bekleyen",
  revize: "Revizede olan",
};

export const COLUMN_LABEL = {
  POOL: "İş Havuzu",
  DOING: "Yapılıyor",
  REVIEW: "Kontrol Ediliyor",
  REVISION: "Revize Ediliyor",
  DONE: "Tamamlandı",
};

export function matchesWorkFilter(task, filtre, today) {
  if (!filtre || !WORK_FILTERS[filtre]) return true;
  if (filtre === "geciken") return task.column !== "DONE" && Boolean(task.dueOn) && task.dueOn < today;
  if (filtre === "bugun") return task.column !== "DONE" && task.dueOn === today;
  if (filtre === "kontrol") return task.column === "REVIEW";
  if (filtre === "revize") return task.column === "REVISION";
  return true;
}

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function weekStartIso(todayIso) {
  const noon = new Date(`${todayIso}T12:00:00+03:00`);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Istanbul", weekday: "short" }).format(noon);
  const index = { Sun: 6, Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5 }[weekday] ?? 0;
  const start = new Date(noon.getTime() - index * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);
}

function wallInstant(value) {
  if (!value || value.length < 16) return null;
  const instant = new Date(`${value.slice(0, 10)}T${value.slice(11, 16)}:00+03:00`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function hoursSince(value, now) {
  const instant = wallInstant(value);
  if (!instant) return 0;
  return Math.max(0, Math.floor((now.getTime() - instant.getTime()) / 3_600_000));
}

function dayGap(dueOn, today) {
  const due = Date.parse(`${dueOn}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  return Math.round((current - due) / 86_400_000);
}

function latestMove(task, column) {
  const moves = (task.moves ?? []).filter((move) => move.column === column);
  return moves.length ? moves[moves.length - 1].createdAt : null;
}

function namesOf(task, people) {
  const names = task.assigneeIds.map((id) => people.get(id)).filter(Boolean);
  return names.length ? names.join(", ") : "Atanmadı";
}

function productOf(task, spaces) {
  return spaces.get(task.spaceId) ?? "Ürün yok";
}

function openTask(task) {
  return task.column !== "DONE";
}

export function buildWorkPulse(actor, board, now = new Date()) {
  const today = board.today;
  const people = new Map(board.people.map((person) => [person.id, person.name]));
  const spaces = new Map(board.spaces.map((space) => [space.id, space.name]));
  const weekStart = weekStartIso(today);
  const overdue = (task) => openTask(task) && task.dueOn && task.dueOn < today;
  const dueToday = (task) => openTask(task) && task.dueOn === today;

  const reviewQueue = board.tasks
    .filter((task) => task.column === "REVIEW")
    .map((task) => {
      const hours = hoursSince(latestMove(task, "REVIEW") || task.createdAt, now);
      return {
        id: task.id,
        title: task.title,
        assignees: namesOf(task, people),
        product: productOf(task, spaces),
        hours,
        tone: hours >= 48 ? "red" : hours >= 24 ? "orange" : "plain",
      };
    })
    .sort((left, right) => right.hours - left.hours || left.title.localeCompare(right.title, "tr"));

  const overdueList = board.tasks
    .filter(overdue)
    .map((task) => ({
      id: task.id,
      title: task.title,
      assignees: namesOf(task, people),
      days: dayGap(task.dueOn, today),
      column: COLUMN_LABEL[task.column] ?? task.column,
    }))
    .sort((left, right) => right.days - left.days || left.title.localeCompare(right.title, "tr"));

  const staff = board.people
    .filter((person) => person.role === "EMPLOYEE")
    .sort((left, right) => left.name.localeCompare(right.name, "tr"));
  const roster = new Map((board.day?.roster ?? []).map((person) => [person.userId, person]));
  const team = staff.map((person) => {
    const owned = board.tasks.filter((task) => task.assigneeIds.includes(person.id));
    const doneThisWeek = owned.filter((task) => {
      if (task.column !== "DONE") return false;
      const entered = latestMove(task, "DONE");
      return Boolean(entered) && entered.slice(0, 10) >= weekStart;
    }).length;
    return {
      userId: person.id,
      name: person.name,
      current: roster.get(person.id)?.current?.title || "Boşta",
      doing: owned.filter((task) => task.column === "DOING").length,
      overdue: owned.filter(overdue).length,
      doneThisWeek,
    };
  });

  const mine = board.tasks.filter((task) => task.assigneeIds.includes(actor.id) && openTask(task));
  const assigned = mine
    .map((task) => ({
      id: task.id,
      title: task.title,
      product: productOf(task, spaces),
      dueOn: task.dueOn,
      column: COLUMN_LABEL[task.column] ?? task.column,
      today: task.dueOn === today,
      overdue: Boolean(task.dueOn) && task.dueOn < today,
    }))
    .sort((left, right) => {
      if (!left.dueOn && !right.dueOn) return left.title.localeCompare(right.title, "tr");
      if (!left.dueOn) return 1;
      if (!right.dueOn) return -1;
      return left.dueOn.localeCompare(right.dueOn) || left.title.localeCompare(right.title, "tr");
    });
  const revision = board.tasks
    .filter((task) => task.assigneeIds.includes(actor.id) && task.column === "REVISION")
    .map((task) => ({
      id: task.id,
      title: task.title,
      product: productOf(task, spaces),
      openItems: (task.revisions ?? []).filter((item) => !item.done).length,
      dueOn: task.dueOn,
    }))
    .sort((left, right) => right.openItems - left.openItems || left.title.localeCompare(right.title, "tr"));

  const scope = actor.role === "ADMIN" ? board.tasks.filter(openTask) : mine;
  const notices = [
    ...scope.filter(overdue).map((task) => ({
      key: `work.overdue:${task.id}`,
      title: "Geciken iş",
      body: `${task.title} · ${dayGap(task.dueOn, today)} gün`,
      href: `/is-takibi?filtre=geciken&kart=${task.id}`,
    })),
    ...(actor.role === "ADMIN"
      ? board.tasks.filter((task) => task.column === "REVIEW").map((task) => ({
          key: `work.review:${task.id}`,
          title: "Kontrol bekliyor",
          body: task.title,
          href: `/is-takibi?filtre=kontrol&kart=${task.id}`,
        }))
      : []),
    ...scope.filter((task) => task.column === "REVISION").map((task) => ({
      key: `work.revision:${task.id}`,
      title: "Revize bekliyor",
      body: task.title,
      href: `/is-takibi?filtre=revize&kart=${task.id}`,
    })),
    ...scope.filter(dueToday).map((task) => ({
      key: `work.due:${task.id}`,
      title: "Bugün teslim",
      body: task.title,
      href: `/is-takibi?filtre=bugun&kart=${task.id}`,
    })),
  ].slice(0, 6);

  const tomorrow = addDays(today, 1);
  const brief = (task) => ({
    id: task.id,
    title: task.title,
    product: productOf(task, spaces),
    priority: task.priority || "NORMAL",
    dueOn: task.dueOn,
    column: task.column,
    columnLabel: COLUMN_LABEL[task.column] ?? task.column,
    daysLate: task.dueOn && task.dueOn < today ? dayGap(task.dueOn, today) : 0,
    openItems: (task.revisions ?? []).filter((item) => !item.done).length,
    reviewHours: hoursSince(latestMove(task, "REVIEW") || task.createdAt, now),
  });
  const byTitle = (left, right) => left.title.localeCompare(right.title, "tr");
  const jobs = mine.map(brief).sort((left, right) => {
    if (!left.dueOn && !right.dueOn) return byTitle(left, right);
    if (!left.dueOn) return 1;
    if (!right.dueOn) return -1;
    return left.dueOn.localeCompare(right.dueOn) || byTitle(left, right);
  });
  const attention = {
    revision: jobs.filter((task) => task.column === "REVISION").sort((left, right) => right.openItems - left.openItems || byTitle(left, right)),
    overdue: jobs.filter((task) => task.column !== "REVISION" && task.daysLate > 0).sort((left, right) => right.daysLate - left.daysLate || byTitle(left, right)),
    soon: jobs.filter((task) => task.column !== "REVISION" && task.daysLate === 0 && (task.dueOn === today || task.dueOn === tomorrow)).sort((left, right) => (left.dueOn ?? "").localeCompare(right.dueOn ?? "") || byTitle(left, right)),
  };
  const ownReview = jobs.filter((task) => task.column === "REVIEW").sort((left, right) => right.reviewHours - left.reviewHours || byTitle(left, right));
  const doingCount = jobs.filter((task) => task.column === "DOING").length;
  const running = (board.day?.now ?? []).find((item) => item.userId === actor.id) ?? null;
  const focused = running ? board.tasks.find((task) => task.id === running.taskId) : null;
  const focus = focused
    ? brief(focused)
    : running?.taskId
      ? { id: running.taskId, title: running.title, product: productOf({ spaceId: running.spaceId }, spaces), priority: "NORMAL", dueOn: null, column: "", columnLabel: "", daysLate: 0, openItems: 0, reviewHours: 0 }
      : null;
  const doneThisWeek = board.tasks.filter((task) => {
    if (!task.assigneeIds.includes(actor.id) || task.column !== "DONE") return false;
    const entered = latestMove(task, "DONE");
    return Boolean(entered) && entered.slice(0, 10) >= weekStart;
  });
  const onTime = doneThisWeek.filter((task) => {
    const entered = latestMove(task, "DONE");
    return !task.dueOn || !entered || entered.slice(0, 10) <= task.dueOn;
  }).length;
  const week = {
    done: doneThisWeek.length,
    onTimePercent: doneThisWeek.length === 0 ? null : Math.round((onTime / doneThisWeek.length) * 100),
  };

  if (actor.role !== "ADMIN") {
    return {
      role: "EMPLOYEE",
      today,
      notices,
      assigned,
      dueToday: assigned.filter((task) => task.today),
      revision,
      focus,
      choices: jobs.map((task) => ({ id: task.id, title: task.title, product: task.product })),
      attention,
      jobs,
      doingCount,
      review: ownReview,
      week,
    };
  }

  return {
    role: "ADMIN",
    today,
    counts: {
      overdue: board.tasks.filter(overdue).length,
      dueToday: board.tasks.filter(dueToday).length,
      review: board.tasks.filter((task) => task.column === "REVIEW").length,
      revision: board.tasks.filter((task) => task.column === "REVISION").length,
    },
    reviewQueue,
    overdueList,
    team,
    assigned,
    dueToday: assigned.filter((task) => task.today),
    revision,
    notices,
  };
}
