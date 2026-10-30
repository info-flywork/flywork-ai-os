import { dateOnly, istanbulToday, toIsoDate } from "@/server/dates";

export const LEAVE_ABSENCE_NOTE = "Onaylı izin";

function coversOfficeDay(duration) {
  return duration === "FULL_DAY" || duration === "MULTI_DAY";
}

function absenceData() {
  return {
    absent: true,
    itemId: null,
    soupItemId: null,
    sideItemId: null,
    dessertItemId: null,
    note: LEAVE_ABSENCE_NOTE,
    status: "RECEIVED",
  };
}

export async function markMealsAbsentForLeave(db, request) {
  if (!coversOfficeDay(request.duration)) {
    return;
  }
  const today = istanbulToday();
  const start = toIsoDate(request.startDate);
  const end = toIsoDate(request.endDate);
  if (start > end) {
    return;
  }
  const menus = await db.mealMenu.findMany({
    where: {
      published: true,
      date: { gte: dateOnly(start), lte: dateOnly(end) },
    },
    select: { id: true, date: true },
  });
  for (const menu of menus) {
    const existing = await db.mealOrder.findUnique({
      where: { userId_menuId: { userId: request.userId, menuId: menu.id } },
      select: { id: true, absent: true },
    });
    if (!existing) {
      await db.mealOrder.create({
        data: { userId: request.userId, menuId: menu.id, ...absenceData() },
      });
      continue;
    }
    if (existing.absent || toIsoDate(menu.date) < today) {
      continue;
    }
    await db.mealOrder.update({ where: { id: existing.id }, data: absenceData() });
  }
}

export async function clearMealsAbsentForLeave(db, request) {
  if (!coversOfficeDay(request.duration)) {
    return;
  }
  const menus = await db.mealMenu.findMany({
    where: {
      date: {
        gte: dateOnly(toIsoDate(request.startDate)),
        lte: dateOnly(toIsoDate(request.endDate)),
      },
    },
    select: { id: true },
  });
  if (menus.length === 0) {
    return;
  }
  await db.mealOrder.deleteMany({
    where: {
      userId: request.userId,
      menuId: { in: menus.map((menu) => menu.id) },
      absent: true,
      note: LEAVE_ABSENCE_NOTE,
    },
  });
}

export async function markMenuAbsentForApprovedLeave(db, menu) {
  const day = dateOnly(typeof menu.date === "string" ? menu.date : toIsoDate(menu.date));
  if (toIsoDate(day) < istanbulToday()) {
    return;
  }
  const requests = await db.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      duration: { in: ["FULL_DAY", "MULTI_DAY"] },
      startDate: { lte: day },
      endDate: { gte: day },
    },
    select: { userId: true },
  });
  for (const request of requests) {
    const existing = await db.mealOrder.findUnique({
      where: { userId_menuId: { userId: request.userId, menuId: menu.id } },
      select: { id: true },
    });
    if (existing) {
      continue;
    }
    await db.mealOrder.create({
      data: { userId: request.userId, menuId: menu.id, ...absenceData() },
    });
  }
}
