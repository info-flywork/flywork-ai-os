const ISTANBUL_OFFSET = "+03:00";

export function inclusiveDayCount(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

export function istanbulToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function istanbulDayRange(now = new Date()) {
  const start = new Date(`${istanbulToday(now)}T00:00:00${ISTANBUL_OFFSET}`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function dateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function toIsoDate(value) {
  return value.toISOString().slice(0, 10);
}

export function formatIstanbulDateTime(value) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

// MySQL DATETIME İstanbul duvar saatidir. Sürücü bu rakamları UTC anı gibi okur.
export function formatMysqlDateTime(value) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}
