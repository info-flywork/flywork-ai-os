 

export function daysUntil(today, due) {
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = Date.parse(`${due}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function addCycle(
  isoDate,
  cycle,
  customIntervalDays,
) {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (cycle === "CUSTOM") {
    if (!customIntervalDays || customIntervalDays < 1) {
      throw new Error("Özel periyot için gün sayısı gerekli.");
    }
    return new Date(Date.UTC(year, month - 1, day + customIntervalDays)).toISOString().slice(0, 10);
  }

  const nextYear = cycle === "YEARLY" ? year + 1 : year;
  const nextMonthIndex = cycle === "MONTHLY" ? month : month - 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(nextYear, nextMonthIndex, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

export const RENEWAL_REMINDER_DAYS = [10, 5, 3, 1] ;

export function reminderThresholds(daysRemaining) {
  if (daysRemaining < 0) {
    return [-1];
  }
  return RENEWAL_REMINDER_DAYS.filter((day) => daysRemaining <= day);
}

export function monthBounds(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
}

export function yearBounds(year) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function groupCurrency(rows) {
  const totals = new Map();
  for (const row of rows) {
    const current = totals.get(row.currency) ?? { total: 0, count: 0 };
    current.total += Number(row.amount);
    current.count += 1;
    totals.set(row.currency, current);
  }
  return [...totals.entries()].map(([currency, value]) => ({
    currency,
    total: value.total.toFixed(2),
    count: value.count,
  }));
}
