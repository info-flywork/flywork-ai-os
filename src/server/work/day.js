import { formatMysqlDateTime } from "@/server/dates";

function clockDay(value) {
  return formatMysqlDateTime(value).slice(0, 10);
}

function clockTime(value) {
  return formatMysqlDateTime(value).slice(11, 16);
}

export function workDayView(sessions, today) {
  const now = [];
  const paused = [];
  const earlier = [];
  const log = [];
  for (const session of sessions) {
    if (!session.endedAt && session.pausedAt) {
      paused.push({ ...session, pausedLabel: clockTime(session.pausedAt) });
      continue;
    }
    if (!session.endedAt) {
      now.push({ ...session, startedLabel: clockTime(session.startedAt) });
      continue;
    }
    const startedDay = clockDay(session.startedAt);
    const endedDay = clockDay(session.endedAt);
    const finished = {
      ...session,
      day: endedDay,
      startedLabel: clockTime(session.startedAt),
      endedLabel: clockTime(session.endedAt),
    };
    log.push(finished);
    if (startedDay === today || endedDay === today) {
      earlier.push(finished);
    }
  }
  now.sort((left, right) => left.startedAt - right.startedAt);
  paused.sort((left, right) => right.pausedAt - left.pausedAt);
  earlier.sort((left, right) => right.endedAt - left.endedAt);
  log.sort((left, right) => right.endedAt - left.endedAt);
  return { now, paused: paused.slice(0, 12), earlier: earlier.slice(0, 12), log };
}

export function visibleWorkDay(actor, people, day) {
  const staff = people
    .filter((person) => person.role === "EMPLOYEE")
    .sort((left, right) => left.name.localeCompare(right.name, "tr"));
  const staffIds = new Set(staff.map((person) => person.id));
  const team = actor.role === "ADMIN";
  const held = day.paused ?? [];
  const onBoard = (userId) => staffIds.has(userId) || userId === actor.id;
  const listed = (userId) => (team ? staffIds.has(userId) || userId === actor.id : userId === actor.id);
  return {
    team,
    now: day.now.filter((item) => onBoard(item.userId)),
    paused: held.filter((item) => listed(item.userId)),
    earlier: day.earlier.filter((item) => (team ? staffIds.has(item.userId) : item.userId === actor.id)),
    log: team ? (day.log ?? []).filter((item) => staffIds.has(item.userId)) : [],
    roster: team
      ? staff.map((person) => ({
          userId: person.id,
          userName: person.name,
          current: day.now.find((item) => item.userId === person.id) ?? null,
          paused: held.find((item) => item.userId === person.id) ?? null,
        }))
      : [],
  };
}
