import { addIsoDays, istanbulClock } from "@/server/meals/schedule";

 























export class LeaveCalcError extends Error {
  constructor(message) {
    super(message);
    this.name = "LeaveCalcError";
  }
}

export function istanbulInstant(date, time = "00:00") {
  return new Date(`${date}T${time}:00+03:00`);
}

export function datesInclusive(start, end) {
  const dates = [];
  let cursor = start;
  while (cursor <= end && dates.length <= 366) {
    dates.push(cursor);
    cursor = addIsoDays(cursor, 1);
  }
  return dates;
}

export function isExcludedDay(date, calendar) {
  const weekday = istanbulClock(new Date(`${date}T12:00:00+03:00`)).weekday;
  return calendar.weekendDays.includes(weekday) || calendar.holidays.includes(date);
}

function hundredths(value) {
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

export function computeLeave(input, calendar) {
  if (!(calendar.hoursPerDay >= 1) || calendar.hoursPerDay > 24) {
    throw new LeaveCalcError("İş günü süresi tanımlı değil.");
  }
  if (input.startDate.slice(0, 4) !== input.endDate.slice(0, 4)) {
    throw new LeaveCalcError("İzin aynı takvim yılı içinde olmalı.");
  }

  if (input.duration === "HOURLY") {
    if (input.startDate !== input.endDate || !input.startTime || !input.endTime) {
      throw new LeaveCalcError("Saatlik izin aynı günde, başlangıç ve bitiş saatiyle alınır.");
    }
    const startsAt = istanbulInstant(input.startDate, input.startTime);
    const endsAt = istanbulInstant(input.endDate, input.endTime);
    const minutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
    if (minutes <= 0) {
      throw new LeaveCalcError("Bitiş saati başlangıçtan sonra olmalı.");
    }
    const dayHundredths = Math.round((minutes * 100) / (calendar.hoursPerDay * 60));
    if (dayHundredths <= 0) {
      throw new LeaveCalcError("İzin süresi çok kısa.");
    }
    const hourHundredths = Math.round((minutes * 100) / 60);
    return {
      startDate: input.startDate,
      endDate: input.endDate,
      startsAt,
      endsAt,
      dayCount: hundredths(dayHundredths),
      hourCount: hundredths(hourHundredths),
      workingDates: [input.startDate],
    };
  }

  const dates = datesInclusive(input.startDate, input.endDate);
  if (dates.length > 366) {
    throw new LeaveCalcError("İzin aralığı en fazla 366 gün olabilir.");
  }
  if (input.duration === "FULL_DAY" && dates.length !== 1) {
    throw new LeaveCalcError("Tam gün izin aynı günde olmalı.");
  }
  if (input.duration === "MULTI_DAY" && dates.length < 2) {
    throw new LeaveCalcError("Çok günlü izinde bitiş tarihi başlangıçtan sonra olmalı.");
  }

  const workingDates = dates.filter((date) => !isExcludedDay(date, calendar));
  if (workingDates.length === 0) {
    throw new LeaveCalcError(
      "Seçilen aralıkta sayılan gün yok. Tatil ve çalışma günü ayarlarını kontrol edin.",
    );
  }

  const endBoundary = addIsoDays(input.endDate, 1);
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    startsAt: istanbulInstant(input.startDate),
    endsAt: istanbulInstant(endBoundary),
    dayCount: hundredths(workingDates.length * 100),
    hourCount: null,
    workingDates,
  };
}

export function formatIstanbulTime(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

export function formatIstanbulDateTime(value) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}
