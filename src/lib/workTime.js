import { formatIstanbulDateTime } from "@/server/dates";

export function wallNowMillis(now = new Date()) {
  return now.getTime();
}

export function pauseGapMillis(pausedAt, now = new Date()) {
  if (!pausedAt) return 0;
  return Math.max(0, wallNowMillis(now) - pausedAt.getTime());
}

export function shiftIsoDate(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function clock(ms) {
  return formatIstanbulDateTime(new Date(ms)).slice(11, 16);
}

function dayOf(ms) {
  return formatIstanbulDateTime(new Date(ms)).slice(0, 10);
}

function nextIstanbulMidnight(isoDay) {
  return Date.parse(`${shiftIsoDate(isoDay, 1)}T00:00:00.000+03:00`);
}

export function formatWorkDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} dk`;
  if (rest === 0) return `${hours} sa`;
  return `${hours} sa ${rest} dk`;
}

function workedEnd(entry, now) {
  const cap = entry.stop ?? wallNowMillis(now);
  return Math.max(entry.start, cap - (entry.pausedMs || 0));
}

function splitStints(entries, now = new Date()) {
  const stints = [];
  for (const entry of entries) {
    const end = workedEnd(entry, now);
    if (!(end > entry.start)) continue;
    let cursor = entry.start;
    while (cursor < end) {
      const current = dayOf(cursor);
      const boundary = nextIstanbulMidnight(current);
      const pieceEnd = Math.min(end, boundary);
      if (pieceEnd > cursor) {
        stints.push({
          userId: entry.userId,
          taskId: entry.taskId,
          title: entry.title,
          day: current,
          start: cursor,
          end: pieceEnd,
          minutes: (pieceEnd - cursor) / 60_000,
          running: entry.stop == null && pieceEnd === end,
        });
      }
      cursor = pieceEnd;
    }
  }
  return stints;
}

function dayStints(entries, day, now = new Date()) {
  return splitStints(entries, now).filter((item) => item.day === day);
}

export function shortDayLabel(iso) {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

export function dayReport(people, entries, day, now = new Date()) {
  const stints = dayStints(entries, day, now);
  return people.map((person) => {
    const mine = stints
      .filter((item) => item.userId === person.userId)
      .sort((left, right) => left.start - right.start || left.title.localeCompare(right.title, "tr"));
    return {
      userId: person.userId,
      name: person.name,
      minutes: mine.reduce((sum, item) => sum + item.minutes, 0),
      running: mine.some((item) => item.running),
      stints: mine.map((item) => ({
        taskId: item.taskId,
        title: item.title,
        from: clock(item.start),
        to: clock(item.end),
        minutes: item.minutes,
        running: item.running,
      })),
    };
  });
}

export function taskDayReport(people, entries, day, now = new Date()) {
  const names = new Map(people.map((person) => [person.userId, person.name]));
  const groups = new Map();
  for (const stint of dayStints(entries, day, now)) {
    const key = stint.taskId || `title:${stint.title}`;
    const current = groups.get(key) ?? {
      taskId: stint.taskId ?? null,
      title: stint.title,
      minutes: 0,
      running: false,
      stints: [],
    };
    current.minutes += stint.minutes;
    current.running = current.running || stint.running;
    current.stints.push({
      userId: stint.userId,
      name: names.get(stint.userId) ?? "",
      from: clock(stint.start),
      to: clock(stint.end),
      minutes: stint.minutes,
      running: stint.running,
    });
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      stints: group.stints.sort((left, right) => left.from.localeCompare(right.from) || left.name.localeCompare(right.name, "tr")),
    }))
    .sort((left, right) => right.minutes - left.minutes || left.title.localeCompare(right.title, "tr"));
}

export function appHistoryReport(people, entries, appName, now = new Date()) {
  const needle = String(appName ?? "").trim();
  if (!needle) return [];
  const lower = needle.toLocaleLowerCase("tr");
  const scoped = entries.filter((entry) => {
    const tagged = String(entry.appName ?? "").toLocaleLowerCase("tr").trim();
    return tagged === lower;
  });
  return taskHistoryReport(people, scoped, now);
}

export function taskHistoryReport(people, entries, now = new Date()) {
  const names = new Map(people.map((person) => [person.userId, person.name]));
  const allowed = new Set(people.map((person) => person.userId));
  const groups = new Map();
  for (const stint of splitStints(entries, now)) {
    if (allowed.size > 0 && !allowed.has(stint.userId)) continue;
    const key = stint.taskId || `title:${stint.title}`;
    const current = groups.get(key) ?? {
      taskId: stint.taskId ?? null,
      title: stint.title,
      minutes: 0,
      running: false,
      days: new Map(),
    };
    current.minutes += stint.minutes;
    current.running = current.running || stint.running;
    const dayRow = current.days.get(stint.day) ?? { day: stint.day, minutes: 0, stints: [] };
    dayRow.minutes += stint.minutes;
    dayRow.stints.push({
      userId: stint.userId,
      name: names.get(stint.userId) ?? "",
      from: clock(stint.start),
      to: clock(stint.end),
      minutes: stint.minutes,
      running: stint.running,
    });
    current.days.set(stint.day, dayRow);
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((group) => ({
      taskId: group.taskId,
      title: group.title,
      minutes: group.minutes,
      running: group.running,
      days: [...group.days.values()]
        .map((row) => ({
          ...row,
          stints: row.stints.sort((left, right) => left.from.localeCompare(right.from) || left.name.localeCompare(right.name, "tr")),
        }))
        .sort((left, right) => right.day.localeCompare(left.day)),
    }))
    .sort((left, right) => right.minutes - left.minutes || left.title.localeCompare(right.title, "tr"));
}
