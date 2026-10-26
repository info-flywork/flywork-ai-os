const DAY_MS = 24 * 60 * 60 * 1000;
const SOON_MS = 6 * 60 * 60 * 1000;

 






export function taskDeadline(task) {
  const date = task.dueOn || task.startsOn;
  if (!date) return null;
  const time = task.endsAt || task.startsAt || "23:59";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return `${date}T${time}:00+03:00`;
}

export function reminderKind(deadline, now) {
  const at = Date.parse(deadline);
  if (Number.isNaN(at)) return null;
  const remaining = at - now.getTime();
  if (remaining <= 0 || remaining > DAY_MS) return null;
  return remaining <= SOON_MS ? "soon" : "day";
}

export function formatWorkDeadlineReminder(input) {
  const [date, clock] = input.deadline.split("T");
  const [year, month, day] = date.split("-");
  const time = clock.slice(0, 5);
  const left = input.kind === "day" ? "1 gün kaldı" : "6 saat kaldı";
  return `Görev yaklaşıyor\n${input.title}\nBitiş: ${day}.${month}.${year} ${time}\n${left}`;
}
