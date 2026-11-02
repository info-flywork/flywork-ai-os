import { addIsoDays, istanbulClock } from "@/server/meals/schedule";

 





export function istanbulInstant(date, hour, minute) {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${date}T${hh}:${mm}:00+03:00`);
}

export function weekdayOf(date) {
  return istanbulClock(new Date(`${date}T12:00:00+03:00`)).weekday;
}

export function windowKeyFromInstant(instant) {
  const clock = istanbulClock(instant);
  const hour = Math.floor(clock.minutes / 60);
  const minute = clock.minutes % 60;
  return `${clock.date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatIstanbul(instant) {
  const key = windowKeyFromInstant(instant);
  return key.replace("T", " ");
}

export function formatDuration(startedAt, finishedAt) {
  if (!finishedAt) {
    return "sürüyor";
  }
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) {
    return `${rest} sn`;
  }
  return `${minutes} dk ${rest} sn`;
}

export function scheduleClocks(schedule) {
  const interval = Number(schedule.intervalHours) || 0;
  const count = interval > 0 && interval < 24 && 24 % interval === 0 ? 24 / interval : 1;
  const clocks = [];
  for (let index = 0; index < count; index += 1) {
    clocks.push({
      hour: (schedule.hour + index * interval) % 24,
      minute: schedule.minute,
    });
  }
  return clocks.sort((left, right) => left.hour - right.hour || left.minute - right.minute);
}

export function matchesSlot(schedule, instant) {
  const [date, clock] = windowKeyFromInstant(instant).split("T");
  if (schedule.weekdays.length > 0 && !schedule.weekdays.includes(weekdayOf(date))) {
    return false;
  }
  return scheduleClocks(schedule).some((slot) => {
    const text = `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`;
    return clock === text;
  });
}

export function nextOccurrence(schedule, after) {
  const start = istanbulClock(after).date;
  const clocks = scheduleClocks(schedule);
  for (let offset = 0; offset < 8; offset += 1) {
    const date = addIsoDays(start, offset);
    if (schedule.weekdays.length > 0 && !schedule.weekdays.includes(weekdayOf(date))) {
      continue;
    }
    for (const clock of clocks) {
      const slot = istanbulInstant(date, clock.hour, clock.minute);
      if (slot.getTime() > after.getTime()) {
        return slot;
      }
    }
  }
  throw new Error("Sonraki çalışma zamanı bulunamadı.");
}

export function retryDelayMs(attempt) {
  const minutes = [1, 5, 15][Math.max(0, Math.min(attempt, 3) - 1)] ?? 15;
  return minutes * 60 * 1000;
}
