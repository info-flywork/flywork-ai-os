const ANNUAL_DAYS_AFTER_ONE_YEAR = "14.00";

export function annualAnniversary(startedOn: string): string {
  const [year, month, day] = startedOn.split("-").map(Number);
  return new Date(Date.UTC(year + 1, month - 1, day)).toISOString().slice(0, 10);
}

export function annualAllocationForYear(startedOn: string | null, year: number, today: string): string | null {
  if (!startedOn || year > Number(today.slice(0, 4))) {
    return null;
  }
  const cutoff = today.slice(0, 4) === String(year) ? today : `${year}-12-31`;
  return annualAnniversary(startedOn) <= cutoff ? ANNUAL_DAYS_AFTER_ONE_YEAR : null;
}
