import { publicHoliday } from "@/server/meals/holidays";

export const MEAL_SETTINGS_ID = "default";
export const DEFAULT_OPENS_AT = "07:00";
export const DEFAULT_CLOSES_AT = "11:00";
export const DEFAULT_MEAL_WEEKDAYS = [1, 2, 4] ;

const WEEKDAY_INDEX = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export const WEEKDAY_LABELS = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
};

 
















export function minutesOfDay(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function istanbulClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const read = (type) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(read("hour"));
  if (hour === 24) {
    hour = 0;
  }
  const weekday = WEEKDAY_INDEX[read("weekday")] ?? 0;

  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    weekday,
    minutes: hour * 60 + Number(read("minute")),
  };
}

export function orderWindow(clock, schedule) {
  const closes = minutesOfDay(schedule.closesAt);
  const dayLabel = schedule.weekdays
    .map((day) => WEEKDAY_LABELS[day])
    .filter(Boolean)
    .join(", ");

  if (!schedule.weekdays.includes(clock.weekday)) {
    return {
      allowed: false,
      message: `Yemek siparişi yalnızca ${dayLabel} günleri alınır.`,
    };
  }

  if (closes === null) {
    return {
      allowed: false,
      message: "Sipariş saati tanımlı değil.",
    };
  }

  if (clock.minutes > closes) {
    return {
      allowed: false,
      message: `Siparişler saat ${schedule.closesAt}'da kapandı. Değişiklik yapılamaz.`,
    };
  }

  return {
    allowed: true,
    message: `Sipariş saat ${schedule.closesAt}'de kapanır.`,
  };
}

export function managerMayEditClosedDay(targetDate, now, schedule) {
  const clock = istanbulClock(now);
  const closes = minutesOfDay(schedule.closesAt);
  return targetDate === clock.date
    && !publicHoliday(targetDate)
    && schedule.weekdays.includes(clock.weekday)
    && closes !== null
    && clock.minutes > closes;
}

export function mealDayWindow(targetDate, now, schedule) {
  if (publicHoliday(targetDate)) {
    return { allowed: false, message: "Resmi tatil." };
  }
  const clock = istanbulClock(now);
  if (targetDate < clock.date) {
    return { allowed: false, message: "Geçmiş günün siparişi değiştirilemez." };
  }
  if (targetDate === clock.date && schedule.weekdays.includes(clock.weekday)) {
    return orderWindow(clock, schedule);
  }
  const upcoming = orderableMealDates(now, schedule, 6);
  if (!upcoming.includes(targetDate)) {
    return { allowed: false, message: "Sipariş yalnızca yaklaşan 6 yemek günü için alınır." };
  }
  if (targetDate > clock.date) {
    const value = new Date(`${targetDate}T00:00:00Z`);
    const weekday = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", weekday: "long" }).format(value);
    const day = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", day: "2-digit" }).format(value);
    const month = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", month: "2-digit" }).format(value);
    const label = `${weekday.charAt(0).toLocaleUpperCase("tr-TR")}${weekday.slice(1)} ${day}.${month}`;
    return { allowed: true, message: `${label} siparişi saat ${schedule.closesAt}'e kadar değiştirilebilir.` };
  }
  return orderWindow(clock, schedule);
}

export function upcomingMealDates(from, weekdays, count) {
  const dates = [];
  let cursor = from;
  for (let step = 0; step < 28 && dates.length < count; step += 1) {
    const weekday = istanbulClock(new Date(`${cursor}T12:00:00+03:00`)).weekday;
    if (weekdays.includes(weekday)) {
      dates.push(cursor);
    }
    cursor = addIsoDays(cursor, 1);
  }
  return dates;
}

export function addIsoDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function mealDispatchDecision(now, scheduledFor, weekdays = DEFAULT_MEAL_WEEKDAYS) {
  const today = istanbulClock(now);
  const slot = istanbulClock(scheduledFor ?? now);
  if (slot.date !== today.date) {
    return { send: false, summary: "Zamanı geçmiş yemek kaydı gönderilmedi." };
  }
  if (publicHoliday(today.date)) {
    return { send: false, summary: "Resmi tatil. Yemek listesi gönderilmedi." };
  }
  const days = (weekdays ?? []).map(Number);
  if (!days.includes(today.weekday)) {
    return { send: false, summary: "Bugün yemek günü değil. Liste gönderilmedi." };
  }
  return { send: true, date: today.date };
}

export function orderableMealDates(now, schedule, count) {
  const clock = istanbulClock(now);
  const closes = minutesOfDay(schedule.closesAt);
  const closedToday = schedule.weekdays.includes(clock.weekday) && closes !== null && clock.minutes > closes;
  return upcomingMealDates(closedToday ? addIsoDays(clock.date, 1) : clock.date, schedule.weekdays, count);
}

function isExtra(name) {
  return name.toLocaleUpperCase("tr-TR") === "CACIK";
}

export function mealLine(order





) {
  if (order.absent) {
    return "Ofiste değil";
  }
  const parts = [];
  const extras = [];
  const push = (name, extra) => {
    const trimmed = name?.trim();
    if (!trimmed) {
      return;
    }
    if (extra || isExtra(trimmed)) {
      extras.push(trimmed);
    } else {
      parts.push(trimmed);
    }
  };
  push(order.item?.name, false);
  push(order.soupItem?.name, false);
  push(order.sideItem?.name, false);
  push(order.dessertItem?.name, true);
  if (parts.length === 0 && extras.length === 0) {
    return "Seçim yok";
  }
  const plate = parts.join(" + ");
  if (extras.length === 0) {
    return plate;
  }
  const extra = `Ekstra: ${extras.join(", ")}`;
  return plate ? `${plate} | ${extra}` : extra;
}

export function orderedMeals(people) {
  return people.filter((person) => person.meal !== "Ofiste değil" && person.meal !== "Seçim yok");
}

export function catererWhatsappLink(phone, text) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("90")
    ? digits
    : digits.startsWith("0")
      ? `90${digits.slice(1)}`
      : digits.length === 10
        ? `90${digits}`
        : "";
  if (!/^90\d{10}$/.test(normalized)) {
    return null;
  }
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

export function formatMealRoster(
  date,
  people,
) {
  const [year, month, day] = date.split("-");
  const label = year && month && day ? `${day}.${month}.${year}` : date;
  const eating = people.filter((person) => person.meal !== "Ofiste değil" && person.meal !== "Seçim yok");
  if (eating.length === 0) {
    return `Merhaba, Flywork Ventures için ${label} siparişimiz:\n\nSipariş yok.`;
  }
  const lines = eating.map((person, index) => {
    const note = person.note?.trim();
    const meal = note ? `${person.meal} | Not: ${note}` : person.meal;
    return `${index + 1}) ${person.name}: ${meal}`;
  });
  return [
    `Merhaba, Flywork Ventures için ${label} siparişimiz (${eating.length} kişi):`,
    "",
    lines.join("\n\n"),
    "",
    `Toplam: ${eating.length} kişilik yemek`,
    "Teşekkürler.",
  ].join("\n");
}

export function formatCatererOrder(
  date,
  rows,
  notes = [],
) {
  const noteLines = notes
    .map((entry) => ({ employeeName: entry.employeeName.trim(), note: entry.note.trim() }))
    .filter((entry) => entry.note)
    .map((entry) => `${entry.employeeName}: ${entry.note}`);
  if (rows.length === 0 && noteLines.length === 0) {
    return `${date} Flywork yemek siparişi\nGönderilecek sipariş yok.`;
  }
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return [
    `${date} Flywork yemek siparişi`,
    ...(rows.length > 0 ? rows.map((row) => `${row.name}: ${row.count}`) : ["Gönderilecek sipariş yok."]),
    `Toplam: ${total}`,
    ...(noteLines.length > 0 ? ["Notlar:", ...noteLines] : []),
    "Bu metin yalnızca kopyalamak içindir.",
  ].join("\n");
}

export function reportRange(
  mode,
  date,
) {
  if (mode === "day") {
    return { from: date, to: date };
  }

  if (mode === "week") {
    const weekday = istanbulClock(new Date(`${date}T12:00:00+03:00`)).weekday;
    const from = addIsoDays(date, -(weekday - 1));
    return { from, to: addIsoDays(from, 6) };
  }

  const [yearText, monthText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthPadded = String(month).padStart(2, "0");
  return {
    from: `${yearText}-${monthPadded}-01`,
    to: `${yearText}-${monthPadded}-${String(lastDay).padStart(2, "0")}`,
  };
}
