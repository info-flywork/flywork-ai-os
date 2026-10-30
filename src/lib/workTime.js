import { formatIstanbulDateTime } from "@/server/dates";

export function wallNowMillis(now = new Date()) {
  const label = formatIstanbulDateTime(now);
  return Date.parse(`${label.slice(0, 10)}T${label.slice(11, 16)}:00.000Z`);
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
  return new Date(ms).toISOString().slice(11, 16);
}

function dayOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
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

export function dayReport(people, entries, day, now = new Date()) {
  const stints = [];
  for (const entry of entries) {
    const end = workedEnd(entry, now);
    if (!(end > entry.start)) continue;
    let cursor = entry.start;
    while (cursor < end) {
      const current = dayOf(cursor);
      const boundary = Date.parse(`${shiftIsoDate(current, 1)}T00:00:00.000Z`);
      const pieceEnd = Math.min(end, boundary);
      if (current === day && pieceEnd > cursor) {
        stints.push({
          userId: entry.userId,
          taskId: entry.taskId,
          title: entry.title,
          start: cursor,
          end: pieceEnd,
          minutes: (pieceEnd - cursor) / 60_000,
          running: entry.stop == null && pieceEnd === end,
        });
      }
      cursor = pieceEnd;
    }
  }
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
