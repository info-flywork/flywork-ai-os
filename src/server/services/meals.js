import "server-only";

import { assertCan } from "@/server/auth/permissions";
import { dateOnly, toIsoDate } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { invalidate, remember } from "@/server/readCache";
import { AppError } from "@/server/errors";
import {
  DEFAULT_CLOSES_AT,
  DEFAULT_MEAL_WEEKDAYS,
  DEFAULT_OPENS_AT,
  MEAL_SETTINGS_ID,
  WEEKDAY_LABELS,
  addIsoDays,
  istanbulClock,
  managerMayEditClosedDay,
  mealDayWindow,
  minutesOfDay,
  catererWhatsappLink,
  orderWindow,
  reportRange,
  orderableMealDates,

} from "@/server/meals/schedule";
import { publicHoliday } from "@/server/meals/holidays";
import { planMenuRevision } from "@/server/meals/menuRevision";
import { parseCatalogPrice } from "@/server/meals/importCatalog";
import { resolveMealSelection } from "@/server/meals/selection";
import { mealOrderTotals } from "@/server/meals/totals";
import {
  daySpend,
  monthSpend,
  pendingDiners,
  personSpendLabel,
  spendLabel,

} from "@/server/meals/spend";
import { inspectMealPhoto, readMealPhoto, removeMealPhoto, writeMealPhoto } from "@/server/meals/photos";
import { formatMealReminder } from "@/server/telegram/messages";
import { deliverTelegram, liveTelegramTransport } from "@/server/telegram/send";
import { randomBytes } from "node:crypto";
import {
  catalogMenuSchema,
  guestMealOrderSchema,
  managedMealOrderSchema,
  mealCategorySchema,
  mealReminderSchema,
  mealDishSchema,
  mealMenuSchema,
  mealOrderSchema,
  mealOrderStatusSchema,
  parseInput,
} from "@/server/validation/schemas";
import { numberList } from "@/server/jsonList";
import { z } from "zod";

async function ensureSettings(db) {
  const settings = await db.mealSettings.upsert({
    where: { id: MEAL_SETTINGS_ID },
    update: {},
    create: {
      id: MEAL_SETTINGS_ID,
      opensAt: DEFAULT_OPENS_AT,
      closesAt: DEFAULT_CLOSES_AT,
      weekdays: [...DEFAULT_MEAL_WEEKDAYS],
    },
  });
  return { ...settings, weekdays: numberList(settings.weekdays) };
}

const closingTimeSchema = z.object({
  closesAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Kapanış saati SS:DD formatında olmalı."),
});

function scrubPrices(value) {
  return JSON.parse(
    JSON.stringify(value, (key, item) => (/price|cost|spend|amount|gider|fiyat/i.test(key) ? undefined : item)),
  ) ;
}

function serializeMenu(menu
















, prices) {
  return {
    id: menu.id,
    date: toIsoDate(menu.date),
    note: menu.note,
    published: menu.published,
    items: menu.items.map((item) => {
      const row = {
        id: item.id,
        dishId: item.dishId ?? item.dish?.id ?? null,
        name: prices ? item.name : item.name.replace(/\s*\(\s*\+?\d+(?:[.,]\d+)?\s*\)/g, " ").replace(/\s+/g, " ").trim(),
        sortOrder: item.sortOrder,
        slot: item.slot,
        available: item.available !== false,
        choiceKey: item.choiceKey ?? null,
        description: item.description ?? null,
        categoryName: item.dish?.category.name ?? null,
        photoUrl: item.dish?.photoKey ? `/api/yemek-foto/${item.dish.id}?v=${item.dish.photoKey.slice(0, 12)}` : null,
      };
      if (!prices) {
        return row;
      }
      return { ...row, priceLabel: priceLabel(item.price) };
    }),
  };
}

function priceLabel(value) {
  if (!value || Number(value.toString()) === 0) {
    return null;
  }
  const [whole, fraction = ""] = value.toString().split(".");
  if (!whole) {
    return null;
  }
  return `${whole},${fraction.padEnd(2, "0").slice(0, 2)} TL`;
}

function chosenNames(order





) {
  if (order.absent) {
    return "Ofiste değil";
  }
  return [order.item?.name, order.soupItem?.name, order.sideItem?.name, order.dessertItem?.name].filter(Boolean).join(" · ");
}

export async function getMealSchedule(actor) {
  assertCan(actor, "mealMenu:read");
  const settings = await withDatabase((db) => ensureSettings(db));
  return {
    opensAt: settings.opensAt,
    closesAt: settings.closesAt,
    weekdays: settings.weekdays,
    weekdayLabels: settings.weekdays.map((day) => WEEKDAY_LABELS[day]).filter(Boolean),
  };
}

export async function updateClosingTime(actor, input) {
  invalidate("meal");
  assertCan(actor, "mealMenu:write");
  const data = parseInput(closingTimeSchema, input);

  return withDatabase(async (db) => {
    const settings = await ensureSettings(db);
    const opens = minutesOfDay(settings.opensAt);
    const closes = minutesOfDay(data.closesAt);
    if (opens === null || closes === null || closes <= opens) {
      throw new AppError(
        "Kapanış saati açılış saatinden sonra olmalı.",
        "VALIDATION",
        400,
      );
    }

    const saved = await db.mealSettings.update({
      where: { id: settings.id },
      data: { closesAt: data.closesAt },
    });
    return { opensAt: saved.opensAt, closesAt: saved.closesAt };
  });
}

const catererPhoneSchema = z.object({
  catererPhone: z.string().trim().max(20),
});

export async function updateCatererPhone(actor, input) {
  invalidate("meal");
  assertCan(actor, "mealMenu:write");
  const data = parseInput(catererPhoneSchema, input);
  const phone = data.catererPhone.replace(/\s+/g, "");
  if (phone && !catererWhatsappLink(phone, "liste")) {
    throw new AppError("WhatsApp numarası 05xx xxx xx xx biçiminde olmalı.", "VALIDATION", 400);
  }
  return withDatabase(async (db) => {
    const settings = await ensureSettings(db);
    const saved = await db.mealSettings.update({
      where: { id: settings.id },
      data: { catererPhone: phone || null },
    });
    return { catererPhone: saved.catererPhone };
  });
}

export async function saveMealMenu(actor, input) {
  invalidate("meal");
  assertCan(actor, "mealMenu:write");
  const data = parseInput(mealMenuSchema, input);
  const weekday = istanbulClock(new Date(`${data.date}T12:00:00+03:00`)).weekday;

  return withDatabase(async (db) => {
    const settings = await ensureSettings(db);
    if (!settings.weekdays.includes(weekday)) {
      throw new AppError(
        "Menü yalnızca Pazartesi, Salı ve Perşembe için oluşturulabilir.",
        "VALIDATION",
        400,
      );
    }

    const existing = await db.mealMenu.findUnique({
      where: { date: dateOnly(data.date) },
      include: { orders: { select: { id: true } }, items: { select: { dishId: true } } },
    });
    if (existing?.items.some((item) => item.dishId)) {
      throw new AppError(
        "Bugünün menüsü katalogdan hazırlandı. Değişiklik katalog planından yapılır.",
        "CONFLICT",
        409,
      );
    }
    if (existing && existing.orders.length > 0) {
      throw new AppError(
        "Bu menüde sipariş var. Yemek listesi değiştirilemez.",
        "CONFLICT",
        409,
      );
    }

    const items = data.items.map((item, index) => ({
      name: item.name,
      sortOrder: index,
    }));

    if (existing) {
      await db.mealMenuItem.deleteMany({ where: { menuId: existing.id } });
      const menu = await db.mealMenu.update({
        where: { id: existing.id },
        data: {
          note: data.note,
          published: data.published,
          items: { create: items },
        },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
      return serializeMenu(menu, true);
    }

    const menu = await db.mealMenu.create({
      data: {
        date: dateOnly(data.date),
        note: data.note,
        published: data.published,
        items: { create: items },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    return serializeMenu(menu, true);
  });
}

const orderSelect = {
  id: true,
  status: true,
  itemId: true,
  soupItemId: true,
  sideItemId: true,
  dessertItemId: true,
  absent: true,
  note: true,
  menuId: true,
  userId: true,
} ;

export async function saveOwnMealOrder(
  actor,
  input,
  now = new Date(),
) {
  invalidate("meal");
  assertCan(actor, "mealOrder:create:own");
  const data = parseInput(mealOrderSchema, input);

  return withDatabase(async (db) => {
    const settings = await ensureSettings(db);
    const menu = await db.mealMenu.findUnique({
      where: { id: data.menuId },
      include: { items: true },
    });
    if (!menu || !menu.published) {
      throw new AppError("Yayındaki menü bulunamadı.", "NOT_FOUND", 404);
    }
    const menuDate = toIsoDate(menu.date);
    const window = mealDayWindow(menuDate, now, settings);
    if (!window.allowed) {
      throw new AppError(window.message, "FORBIDDEN", 403);
    }
    const selection = resolveMealSelection(menu.items, data);
    if (!selection.ok) {
      throw new AppError(selection.message, "VALIDATION", 400);
    }

    const payload = {
      itemId: selection.itemId,
      soupItemId: selection.soupItemId,
      sideItemId: selection.sideItemId,
      dessertItemId: selection.dessertItemId,
      absent: selection.absent,
      note: selection.note,
      status: "RECEIVED" ,
    };
    const existing = await db.mealOrder.findUnique({
      where: { userId_menuId: { userId: actor.id, menuId: menu.id } },
    });
    if (existing) {
      const order = await db.mealOrder.update({
        where: { id: existing.id },
        data: payload,
        select: orderSelect,
      });
      return { ...order, changed: true };
    }

    const order = await db.mealOrder.create({
      data: { userId: actor.id, menuId: menu.id, ...payload },
      select: orderSelect,
    });
    return { ...order, changed: false };
  });
}

export async function clearOwnMealAbsence(actor, menuId, now = new Date()) {
  invalidate("meal");
  assertCan(actor, "mealOrder:create:own");
  if (!menuId.trim()) {
    throw new AppError("Menü bulunamadı.", "VALIDATION", 400);
  }
  return withDatabase(async (db) => {
    const settings = await ensureSettings(db);
    const menu = await db.mealMenu.findUnique({ where: { id: menuId } });
    if (!menu || !menu.published) {
      throw new AppError("Yayındaki menü bulunamadı.", "NOT_FOUND", 404);
    }
    const window = mealDayWindow(toIsoDate(menu.date), now, settings);
    if (!window.allowed) {
      throw new AppError(window.message, "FORBIDDEN", 403);
    }
    const existing = await db.mealOrder.findUnique({
      where: { userId_menuId: { userId: actor.id, menuId: menu.id } },
      select: { id: true, absent: true },
    });
    if (!existing?.absent) {
      return { cleared: false };
    }
    await db.mealOrder.delete({ where: { id: existing.id } });
    return { cleared: true };
  });
}

export async function cancelOwnMealOrder(actor, menuId, now = new Date()) {
  invalidate("meal");
  assertCan(actor, "mealOrder:create:own");
  if (!menuId.trim()) {
    throw new AppError("Menü bulunamadı.", "VALIDATION", 400);
  }
  return withDatabase(async (db) => {
    const settings = await ensureSettings(db);
    const menu = await db.mealMenu.findUnique({ where: { id: menuId } });
    if (!menu || !menu.published) {
      throw new AppError("Yayındaki menü bulunamadı.", "NOT_FOUND", 404);
    }
    const window = mealDayWindow(toIsoDate(menu.date), now, settings);
    if (!window.allowed) {
      throw new AppError(window.message, "FORBIDDEN", 403);
    }
    const existing = await db.mealOrder.findUnique({
      where: { userId_menuId: { userId: actor.id, menuId: menu.id } },
      select: { id: true, absent: true, note: true, itemId: true, soupItemId: true, sideItemId: true, dessertItemId: true },
    });
    if (!existing) {
      return { cancelled: false };
    }
    await db.mealOrder.delete({ where: { id: existing.id } });
    await db.mealOrderAudit.create({
      data: {
        actorId: actor.id,
        action: "CANCEL",
        orderId: existing.id,
        subjectUserId: actor.id,
        subjectName: actor.name,
        changes: { before: existing, after: null } ,
      },
    });
    return { cancelled: true };
  });
}

export async function listOwnMealOrders(actor) {
  assertCan(actor, "mealOrder:read:own");
  const orders = await withDatabase((db) =>
    db.mealOrder.findMany({
      where: { userId: actor.id },
      orderBy: { menu: { date: "desc" } },
      select: {
        id: true,
        status: true,
        absent: true,
        note: true,
        item: { select: { name: true } },
        soupItem: { select: { name: true } },
        sideItem: { select: { name: true } },
        dessertItem: { select: { name: true } },
        menu: { select: { date: true } },
      },
    }),
  );

  return orders.map((order) => ({
    id: order.id,
    status: order.status,
    absent: order.absent,
    note: order.note,
    itemName: chosenNames(order),
    date: toIsoDate(order.menu.date),
  }));
}

const menuItemInclude = {
  orderBy: { sortOrder: "asc"  },
  include: { dish: { include: { category: { select: { name: true } } } } },
};

function sqlBool(value, fallback = false) {
  if (value == null) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return Number(value) !== 0;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return value.length > 0 && value[0] !== 0;
  }
  return value === "1" || value === "true";
}

function groupMealMenus(rows) {
  const menus = new Map();
  for (const row of rows) {
    let menu = menus.get(row.menuId);
    if (!menu) {
      menu = {
        id: row.menuId,
        date: dateOnly(String(row.menuDate).slice(0, 10)),
        note: row.menuNote,
        published: sqlBool(row.published, true),
        items: [],
      };
      menus.set(row.menuId, menu);
    }
    if (!row.itemId) {
      continue;
    }
    menu.items.push({
      id: row.itemId,
      dishId: row.dishId,
      name: row.itemName,
      sortOrder: Number(row.sortOrder ?? 0),
      slot: row.slot,
      available: sqlBool(row.available, true),
      choiceKey: row.choiceKey,
      description: row.description,
      price: row.price,
      dish: row.dishId
        ? { id: row.dishId, photoKey: row.photoKey, category: { name: row.categoryName ?? null } }
        : null,
    });
  }
  return [...menus.values()];
}

function groupMealOrders(rows) {
  return rows.map((row) => ({
    id: row.orderId,
    status: row.status,
    absent: sqlBool(row.absent),
    note: row.note,
    menuId: row.menuId,
    itemId: row.itemId,
    soupItemId: row.soupItemId,
    sideItemId: row.sideItemId,
    dessertItemId: row.dessertItemId,
    item: row.itemName ? { name: row.itemName } : null,
    soupItem: row.soupName ? { name: row.soupName } : null,
    sideItem: row.sideName ? { name: row.sideName } : null,
    dessertItem: row.dessertName ? { name: row.dessertName } : null,
    menu: { date: dateOnly(String(row.menuDate).slice(0, 10)) },
  }));
}

export async function getEmployeeMealView(actor, now = new Date()) {
  assertCan(actor, "mealMenu:read");
  const clock = istanbulClock(now);

  return remember(`meal:employee:${actor.id}:${clock.date}`, () => withDatabase(async (db) => {
    const from = dateOnly(clock.date);
    const to = dateOnly(addIsoDays(clock.date, 14));
    const [settingsRow, menuRows, orderRows] = await Promise.all([
      db.mealSettings.findUnique({ where: { id: MEAL_SETTINGS_ID } }),
      db.$queryRaw`
        SELECT
          m.id AS menuId,
          DATE_FORMAT(m.date, '%Y-%m-%d') AS menuDate,
          m.note AS menuNote,
          m.published AS published,
          i.id AS itemId,
          i.dishId AS dishId,
          i.name AS itemName,
          i.sortOrder AS sortOrder,
          i.slot AS slot,
          i.available AS available,
          i.choiceKey AS choiceKey,
          i.description AS description,
          i.price AS price,
          d.photoKey AS photoKey,
          c.name AS categoryName
        FROM \`MealMenu\` m
        LEFT JOIN \`MealMenuItem\` i ON i.menuId = m.id
        LEFT JOIN \`MealDish\` d ON d.id = i.dishId
        LEFT JOIN \`MealCategory\` c ON c.id = d.categoryId
        WHERE m.published = 1 AND m.date >= ${from} AND m.date <= ${to}
        ORDER BY m.date ASC, i.sortOrder ASC
      `,
      db.$queryRaw`
        SELECT
          o.id AS orderId,
          o.status AS status,
          o.absent AS absent,
          o.note AS note,
          o.menuId AS menuId,
          o.itemId AS itemId,
          o.soupItemId AS soupItemId,
          o.sideItemId AS sideItemId,
          o.dessertItemId AS dessertItemId,
          DATE_FORMAT(m.date, '%Y-%m-%d') AS menuDate,
          i.name AS itemName,
          s.name AS soupName,
          sd.name AS sideName,
          de.name AS dessertName
        FROM \`MealOrder\` o
        JOIN \`MealMenu\` m ON m.id = o.menuId
        LEFT JOIN \`MealMenuItem\` i ON i.id = o.itemId
        LEFT JOIN \`MealMenuItem\` s ON s.id = o.soupItemId
        LEFT JOIN \`MealMenuItem\` sd ON sd.id = o.sideItemId
        LEFT JOIN \`MealMenuItem\` de ON de.id = o.dessertItemId
        WHERE o.userId = ${actor.id}
        ORDER BY m.date DESC
        LIMIT 40
      `,
    ]);
    const settings = settingsRow
      ? { ...settingsRow, weekdays: numberList(settingsRow.weekdays) }
      : {
          opensAt: DEFAULT_OPENS_AT,
          closesAt: DEFAULT_CLOSES_AT,
          weekdays: [...DEFAULT_MEAL_WEEKDAYS],
          catererPhone: null,
        };
    const dates = orderableMealDates(now, settings, 6);
    const menus = groupMealMenus(menuRows).filter((menu) => dates.includes(toIsoDate(menu.date)));
    const allOrders = groupMealOrders(orderRows);
    const history = allOrders.slice(0, 30);
    const menuIds = new Set(menus.map((menu) => menu.id));
    const orders = allOrders.filter((order) => menuIds.has(order.menuId));
    const menuByDate = new Map(menus.map((menu) => [toIsoDate(menu.date), menu]));
    const orderByMenu = new Map(orders.map((order) => [order.menuId, order]));
    const days = dates.map((date) => {
      const menu = menuByDate.get(date);
      const visible = menu ? serializeMenu(menu, false) : null;
      const order = menu ? orderByMenu.get(menu.id) : undefined;
      const window = mealDayWindow(date, now, settings);
      const holiday = Boolean(publicHoliday(date));
      return {
        date,
        holiday,
        open: !holiday && window.allowed && Boolean(visible),
        message: holiday ? "Resmi tatil." : visible ? window.message : "Bugün için yayınlanmış menü yok.",
        menu: visible,
        order: order
          ? {
              id: order.id,
              itemId: order.itemId,
              soupItemId: order.soupItemId,
              sideItemId: order.sideItemId,
              dessertItemId: order.dessertItemId,
              absent: order.absent,
              note: order.note,
              status: order.status,
            }
          : null,
      };
    });
    const todayMenu = days.find((day) => day.date === clock.date)?.menu ?? null;
    const todayOrder = days.find((day) => day.date === clock.date)?.order ?? null;

    return {
      today: clock.date,
      schedule: {
        opensAt: settings.opensAt,
        closesAt: settings.closesAt,
        weekdays: settings.weekdays,
        weekdayLabels: settings.weekdays.map((day) => WEEKDAY_LABELS[day]).filter(Boolean),
        catererPhone: settings.catererPhone,
      },
      window: mealDayWindow(clock.date, now, settings),
      menu: todayMenu,
      days,
      ownOrder: todayOrder
        ? {
            id: todayOrder.id,
            itemId: todayOrder.itemId,
            itemName: todayOrder.absent
              ? "Ofiste değil"
              : [todayOrder.itemId, todayOrder.soupItemId, todayOrder.sideItemId, todayOrder.dessertItemId]
                  .map((id) => todayMenu?.items.find((item) => item.id === id)?.name)
                  .filter(Boolean)
                  .join(" · "),
            status: todayOrder.status,
            absent: todayOrder.absent,
            note: todayOrder.note,
            soupItemId: todayOrder.soupItemId,
            sideItemId: todayOrder.sideItemId,
            dessertItemId: todayOrder.dessertItemId,
          }
        : null,
      history: history.map((order) => ({
        id: order.id,
        status: order.status,
        itemName: chosenNames(order),
        date: toIsoDate(order.menu.date),
      })),
    };
  })).then((view) => (actor.role === "ADMIN" ? view : scrubPrices(view)));
}

 

export async function getAdminMealView(
  actor,
  date,
  mode,
  now = new Date(),
) {
  assertCan(actor, "mealOrder:read:all");
  const clock = istanbulClock(now);
  const range = reportRange(mode, date);
  const dayEnd = addIsoDays(date, 1);

  return remember(`meal:admin:${actor.id}:${date}:${mode}`, () => withDatabase(async (db) => {
    const day = dateOnly(date);
    const [settingsRow, menu, people, guestOrders, dayOrders, reportOrders] = await Promise.all([
      db.mealSettings.findUnique({ where: { id: MEAL_SETTINGS_ID } }),
      db.mealMenu.findUnique({
        where: { date: day },
        include: { items: menuItemInclude, orders: { select: { id: true } } },
      }),
      db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      db.mealGuestOrder.findMany({
        where: { menu: { date: day } },
        orderBy: { guestName: "asc" },
        select: {
          id: true,
          guestName: true,
          note: true,
          item: { select: { id: true, name: true } },
          soupItem: { select: { id: true, name: true } },
          sideItem: { select: { id: true, name: true } },
          dessertItem: { select: { id: true, name: true } },
        },
      }),
      db.mealOrder.findMany({
        where: { menu: { date: day } },
        orderBy: { user: { name: "asc" } },
        select: {
          id: true,
          status: true,
          absent: true,
          note: true,
          user: { select: { id: true, name: true } },
          item: { select: { id: true, name: true, available: true } },
          soupItem: { select: { id: true, name: true, available: true } },
          sideItem: { select: { id: true, name: true, available: true } },
          dessertItem: { select: { id: true, name: true, available: true } },
        },
      }),
      db.mealOrder.findMany({
        where: {
          status: { not: "CANCELLED" },
          menu: { date: { gte: dateOnly(range.from), lte: dateOnly(range.to) } },
        },
        select: {
          absent: true,
          status: true,
          item: { select: { name: true } },
          soupItem: { select: { name: true } },
          sideItem: { select: { name: true } },
          dessertItem: { select: { name: true } },
          user: { select: { name: true } },
          menu: { select: { date: true } },
        },
      }),
    ]);
    const settings = settingsRow
      ? { ...settingsRow, weekdays: numberList(settingsRow.weekdays) }
      : {
          opensAt: DEFAULT_OPENS_AT,
          closesAt: DEFAULT_CLOSES_AT,
          weekdays: [...DEFAULT_MEAL_WEEKDAYS],
          catererPhone: null,
        };

    const byItem = new Map();
    const byEmployee = new Map();
    for (const order of reportOrders) {
      const label = chosenNames(order);
      if (!order.absent) {
        for (const name of [order.item?.name, order.soupItem?.name, order.sideItem?.name, order.dessertItem?.name]) {
          if (name) {
            byItem.set(name, (byItem.get(name) ?? 0) + 1);
          }
        }
      }
      const rows = byEmployee.get(order.user.name) ?? [];
      rows.push({ date: toIsoDate(order.menu.date), itemName: label });
      byEmployee.set(order.user.name, rows);
    }

    const offered = (item) => (item && item.available ? item : null);
    const countable = dayOrders.map((order) => ({
      ...order,
      item: offered(order.item),
      soupItem: offered(order.soupItem),
      sideItem: offered(order.sideItem),
      dessertItem: offered(order.dessertItem),
    }));
    const totals = mealOrderTotals(countable);
    const invalidSelections = dayOrders.flatMap((order) => {
      if (order.status === "CANCELLED" || order.absent) {
        return [];
      }
      return [order.item, order.soupItem, order.sideItem, order.dessertItem]
        .filter((item) => item !== null && item.available === false)
        .map((item) => ({
          orderId: order.id,
          employeeName: order.user.name,
          itemName: item.name,
        }));
    });
    const catererSummary = totals.rows;

    return {
      today: clock.date,
      selectedDate: date,
      dayEnd,
      mode,
      range,
      schedule: {
        opensAt: settings.opensAt,
        closesAt: settings.closesAt,
        weekdays: settings.weekdays,
        weekdayLabels: settings.weekdays
          .map((day) => WEEKDAY_LABELS[day])
          .filter(Boolean),
        catererPhone: settings.catererPhone,
      },
      window: mealDayWindow(date, now, settings) ,
      menu: menu
        ? {
            ...serializeMenu(menu, true),
            orderCount: menu.orders.length,
          }
        : null,
      orders: dayOrders.map((order) => ({
        id: order.id,
        userId: order.user.id,
        status: order.status,
        absent: order.absent,
        note: order.note,
        employeeName: order.user.name,
        itemId: order.item?.id ?? null,
        soupItemId: order.soupItem?.id ?? null,
        sideItemId: order.sideItem?.id ?? null,
        dessertItemId: order.dessertItem?.id ?? null,
        itemName: chosenNames(order),
        mainName: order.item?.name ?? null,
        soupName: order.soupItem?.name ?? null,
        sideName: order.sideItem?.name ?? null,
        dessertName: order.dessertItem?.name ?? null,
        kind: "employee" ,
        invalidItems: [order.item, order.soupItem, order.sideItem, order.dessertItem]
          .filter((item) => item !== null && item.available === false)
          .map((item) => item.name),
      })),
      guests: guestOrders.map((order) => ({
        id: order.id,
        guestName: order.guestName,
        note: order.note,
        itemId: order.item?.id ?? null,
        soupItemId: order.soupItem?.id ?? null,
        sideItemId: order.sideItem?.id ?? null,
        dessertItemId: order.dessertItem?.id ?? null,
        mainName: order.item?.name ?? null,
        soupName: order.soupItem?.name ?? null,
        sideName: order.sideItem?.name ?? null,
        dessertName: order.dessertItem?.name ?? null,
      })),
      people,
      ...(menu?.published
        ? pendingDiners(
            people,
            dayOrders.map((order) => ({ userId: order.user.id, absent: order.absent, status: order.status })),
          )
        : { pending: [], away: [] }),
      absentCount: totals.absent,
      invalidSelections,
      slotSummary: { main: totals.main, soup: totals.soup, side: totals.side, dessert: totals.dessert },
      catererSummary,
      report: {
        total: reportOrders.length,
        byItem: [...byItem.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((left, right) => right.count - left.count),
        byEmployee: [...byEmployee.entries()]
          .map(([name, orders]) => ({ name, orders }))
          .sort((left, right) => left.name.localeCompare(right.name, "tr")),
      },
    };
  }));
}

export async function updateMealOrderStatus(
  actor,
  orderId,
  input,
) {
  invalidate("meal");
  assertCan(actor, "mealOrder:updateStatus");
  const data = parseInput(mealOrderStatusSchema, input);

  return withDatabase((db) =>
    db.mealOrder.update({
      where: { id: orderId },
      data: { status: data.status },
      select: { id: true, status: true },
    }),
  );
}

export async function listMealCatalog(actor) {
  assertCan(actor, "mealMenu:read");
  return remember("meal:catalog", () => withDatabase(async (db) => {
    const categories = await db.mealCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: { dishes: { orderBy: { name: "asc" } } },
    });
    const visible = categories.map((category) => ({
      id: category.id,
      name: category.name,
      active: category.active,
      dishes: category.dishes.map((dish) => ({
        id: dish.id,
        name: dish.name,
        slot: dish.slot,
        active: dish.active,
        description: dish.description,
        ...(actor.role === "ADMIN" ? { priceLabel: priceLabel(dish.price) } : {}),
        photoUrl: dish.photoKey ? `/api/yemek-foto/${dish.id}?v=${dish.photoKey.slice(0, 12)}` : null,
      })),
    }));
    return actor.role === "ADMIN" ? visible : scrubPrices(visible);
  }));
}

export async function saveMealCategory(actor, input) {
  invalidate("meal");
  assertCan(actor, "mealMenu:write");
  const data = parseInput(mealCategorySchema, input);
  return withDatabase((db) =>
    db.mealCategory.create({
      data: {
        id: `cat-${randomBytes(6).toString("hex")}`,
        name: data.name,
        sortOrder: 100,
      },
      select: { id: true, name: true },
    }),
  );
}

export async function saveMealDish(
  actor,
  input,
  photo,
) {
  invalidate("meal");
  assertCan(actor, "mealMenu:write");
  const data = parseInput(mealDishSchema, input);
  const priced = parseCatalogPrice(data.price ?? "");
  if (!priced.ok) {
    throw new AppError(priced.message, "VALIDATION", 400);
  }
  const description = data.description?.trim() ? data.description.trim() : null;
  const checked = photo ? inspectMealPhoto(photo) : null;

  return withDatabase(async (db) => {
    const category = await db.mealCategory.findUnique({ where: { id: data.categoryId } });
    if (!category || !category.active) {
      throw new AppError("Kategori bulunamadı.", "VALIDATION", 400);
    }
    const id = data.id || undefined;
    if (id) {
      const current = await db.mealDish.findUnique({ where: { id } });
      if (!current) {
        throw new AppError("Yemek bulunamadı.", "NOT_FOUND", 404);
      }
      let photoKey = current.photoKey;
      let photoType = current.photoType;
      const previousKey = current.photoKey;
      if (checked) {
        photoKey = randomBytes(16).toString("hex");
        photoType = checked.contentType;
        await writeMealPhoto(photoKey, checked.bytes);
      }
      const updated = await db.mealDish.update({
        where: { id },
        data: {
          name: data.name,
          categoryId: data.categoryId,
          slot: data.slot,
          active: data.active,
          price: priced.price,
          description,
          photoKey,
          photoType,
        },
        select: { id: true, name: true },
      });
      if (checked) {
        await removeMealPhoto(previousKey);
      }
      return updated;
    }

    const photoKey = checked ? randomBytes(16).toString("hex") : null;
    if (checked && photoKey) {
      await writeMealPhoto(photoKey, checked.bytes);
    }
    return db.mealDish.create({
      data: {
        name: data.name,
        categoryId: data.categoryId,
        slot: data.slot,
        active: data.active,
        price: priced.price,
        description,
        photoKey,
        photoType: checked?.contentType ?? null,
      },
      select: { id: true, name: true },
    });
  });
}

export async function openMealPhoto(actor, dishId) {
  assertCan(actor, "mealMenu:read");
  const dish = await withDatabase((db) =>
    db.mealDish.findUnique({
      where: { id: dishId },
      select: { photoKey: true, photoType: true },
    }),
  );
  if (!dish?.photoKey || !dish.photoType) {
    throw new AppError("Fotoğraf bulunamadı.", "NOT_FOUND", 404);
  }
  return {
    bytes: await readMealPhoto(dish.photoKey),
    contentType: dish.photoType,
  };
}

function menuItemData(
  dish






,
  sortOrder,
) {
  return {
    name: dish.name,
    dishId: dish.id,
    slot: dish.slot,
    price: dish.price,
    choiceKey: dish.choiceKey ?? null,
    description: dish.description,
    sortOrder,
    available: true,
  };
}

export async function publishCatalogMenu(actor, input, now = new Date()) {
  invalidate("meal");
  assertCan(actor, "mealMenu:write");
  const data = parseInput(catalogMenuSchema, input);
  const settings = await withDatabase(ensureSettings);
  const weekday = istanbulClock(new Date(`${data.date}T12:00:00+03:00`)).weekday;
  if (!settings.weekdays.includes(weekday)) {
    throw new AppError("Menü yalnızca Pazartesi, Salı ve Perşembe için kaydedilir.", "VALIDATION", 400);
  }
  const clock = istanbulClock(now);
  if (data.date < clock.date) {
    throw new AppError("Geçmiş günün menüsü değiştirilemez.", "FORBIDDEN", 403);
  }
  if (data.date === clock.date) {
    const window = orderWindow(clock, settings);
    if (!window.allowed) {
      throw new AppError(window.message, "FORBIDDEN", 403);
    }
  }
  const dishIds = [...new Set(data.dishIds)];

  return withDatabase(async (db) => {
    const dishes = await db.mealDish.findMany({
      where: { id: { in: dishIds }, active: true },
    });
    if (dishes.length !== dishIds.length) {
      throw new AppError("Menüde aktif olmayan yemek var.", "VALIDATION", 400);
    }
    const dishById = new Map(dishes.map((dish) => [dish.id, dish]));
    const existing = await db.mealMenu.findUnique({
      where: { date: dateOnly(data.date) },
      include: {
        items: true,
        orders: {
          select: {
            id: true,
            absent: true,
            itemId: true,
            soupItemId: true,
            sideItemId: true,
            dessertItemId: true,
            user: { select: { name: true } },
          },
        },
        guestOrders: {
          select: {
            id: true,
            guestName: true,
            itemId: true,
            soupItemId: true,
            sideItemId: true,
            dessertItemId: true,
          },
        },
      },
    });
    const note = data.note || null;
    if (!existing) {
      const menu = await db.mealMenu.create({
        data: {
          date: dateOnly(data.date),
          note,
          published: data.published,
          items: {
            create: dishIds.map((id, index) => menuItemData(dishById.get(id), index)),
          },
        },
        select: { id: true, published: true },
      });
      return { ...menu, conflicts: []  };
    }

    const plan = planMenuRevision(
      existing.items.map((item) => ({ id: item.id, dishId: item.dishId, name: item.name })),
      dishIds,
      [
        ...existing.orders.map((order) => ({
          id: order.id,
          employeeName: order.user.name,
          absent: order.absent,
          choices: [
            { slotLabel: "Ana yemek", itemId: order.itemId },
            { slotLabel: "Çorba", itemId: order.soupItemId },
            { slotLabel: "Pilav / garnitür", itemId: order.sideItemId },
            { slotLabel: "Tatlı", itemId: order.dessertItemId },
          ],
        })),
        ...existing.guestOrders.map((order) => ({
          id: order.id,
          employeeName: order.guestName,
          absent: false,
          choices: [
            { slotLabel: "Ana yemek", itemId: order.itemId },
            { slotLabel: "Çorba", itemId: order.soupItemId },
            { slotLabel: "Pilav / garnitür", itemId: order.sideItemId },
            { slotLabel: "Tatlı", itemId: order.dessertItemId },
          ],
        })),
      ],
    );

    await db.$transaction(async (tx) => {
      if (plan.deleteIds.length > 0) {
        await tx.mealMenuItem.deleteMany({ where: { id: { in: plan.deleteIds }, menuId: existing.id } });
      }
      if (plan.unavailableIds.length > 0) {
        await tx.mealMenuItem.updateMany({
          where: { id: { in: plan.unavailableIds }, menuId: existing.id },
          data: { available: false },
        });
      }
      for (const update of plan.updates) {
        const current = existing.items.find((item) => item.id === update.itemId);
        const dish = current?.dishId ? dishById.get(current.dishId) : undefined;
        if (!dish) {
          continue;
        }
        await tx.mealMenuItem.update({
          where: { id: update.itemId },
          data: {
            ...menuItemData(dish, update.sortOrder),
          },
        });
      }
      if (plan.creates.length > 0) {
        await tx.mealMenuItem.createMany({
          data: plan.creates.map((create) => ({
            menuId: existing.id,
            ...menuItemData(dishById.get(create.dishId), create.sortOrder),
          })),
        });
      }
      await tx.mealMenu.update({
        where: { id: existing.id },
        data: { note, published: data.published },
      });
    });

    return { id: existing.id, published: data.published, conflicts: plan.conflicts };
  });
}

const MONTH_LABELS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];



function choiceRows(choices) {
  return choices
    .filter((choice) => choice !== null)
    .map((choice) => ({ name: choice.name, price: choice.price ? choice.price.toString() : null }));
}

async function requireOpenMenu(db, menuId, now, manager = false) {
  const settings = await ensureSettings(db);
  const menu = await db.mealMenu.findUnique({
    where: { id: menuId },
    include: { items: true },
  });
  if (!menu || !menu.published) {
    throw new AppError("Yayındaki menü bulunamadı.", "NOT_FOUND", 404);
  }
  const menuDate = toIsoDate(menu.date);
  const window = mealDayWindow(menuDate, now, settings);
  if (!window.allowed && !(manager && managerMayEditClosedDay(menuDate, now, settings))) {
    throw new AppError(window.message, "FORBIDDEN", 403);
  }
  return menu;
}

export async function saveManagedMealOrder(actor, input, now = new Date()) {
  invalidate("meal");
  assertCan(actor, "mealOrder:updateStatus");
  const data = parseInput(managedMealOrderSchema, input);
  return withDatabase(async (db) => {
    const subject = await db.user.findUnique({
      where: { id: data.userId },
      select: { id: true, name: true, active: true },
    });
    if (!subject?.active) {
      throw new AppError("Çalışan bulunamadı.", "NOT_FOUND", 404);
    }
    const menu = await requireOpenMenu(db, data.menuId, now, true);
    const selection = resolveMealSelection(menu.items, data);
    if (!selection.ok) {
      throw new AppError(selection.message, "VALIDATION", 400);
    }
    const payload = {
      itemId: selection.itemId,
      soupItemId: selection.soupItemId,
      sideItemId: selection.sideItemId,
      dessertItemId: selection.dessertItemId,
      absent: selection.absent,
      note: selection.note,
      status: "RECEIVED" ,
    };
    const existing = await db.mealOrder.findUnique({
      where: { userId_menuId: { userId: subject.id, menuId: menu.id } },
      select: { id: true, absent: true, note: true, itemId: true, soupItemId: true, sideItemId: true, dessertItemId: true },
    });
    const order = existing
      ? await db.mealOrder.update({ where: { id: existing.id }, data: payload, select: { id: true } })
      : await db.mealOrder.create({ data: { userId: subject.id, menuId: menu.id, ...payload }, select: { id: true } });
    await db.mealOrderAudit.create({
      data: {
        actorId: actor.id,
        action: existing ? "UPDATE" : "CREATE",
        orderId: order.id,
        subjectUserId: subject.id,
        subjectName: subject.name,
        changes: { before: existing, after: payload } ,
      },
    });
    return { id: order.id, changed: Boolean(existing) };
  });
}

export async function saveGuestMealOrder(actor, input, now = new Date()) {
  invalidate("meal");
  assertCan(actor, "mealOrder:updateStatus");
  const data = parseInput(guestMealOrderSchema, input);
  return withDatabase(async (db) => {
    const menu = await requireOpenMenu(db, data.menuId, now, true);
    const selection = resolveMealSelection(menu.items, { ...data, absent: false });
    if (!selection.ok || selection.absent) {
      throw new AppError(selection.ok ? "Misafir siparişi ofiste olmama olarak kaydedilemez." : selection.message, "VALIDATION", 400);
    }
    const payload = {
      guestName: data.guestName,
      itemId: selection.itemId,
      soupItemId: selection.soupItemId,
      sideItemId: selection.sideItemId,
      dessertItemId: selection.dessertItemId,
      note: selection.note,
    };
    const existing = data.guestOrderId
      ? await db.mealGuestOrder.findFirst({ where: { id: data.guestOrderId, menuId: menu.id } })
      : null;
    if (data.guestOrderId && !existing) {
      throw new AppError("Misafir siparişi bulunamadı.", "NOT_FOUND", 404);
    }
    const order = existing
      ? await db.mealGuestOrder.update({ where: { id: existing.id }, data: payload, select: { id: true } })
      : await db.mealGuestOrder.create({ data: { menuId: menu.id, createdById: actor.id, ...payload }, select: { id: true } });
    await db.mealOrderAudit.create({
      data: {
        actorId: actor.id,
        action: existing ? "UPDATE_GUEST" : "CREATE_GUEST",
        guestOrderId: order.id,
        subjectName: data.guestName,
        changes: { before: existing, after: payload } ,
      },
    });
    return { id: order.id, changed: Boolean(existing) };
  });
}

export async function prepareMealReminder(actor, input, now = new Date()) {
  assertCan(actor, "mealOrder:updateStatus");
  const data = parseInput(mealReminderSchema, input);
  return withDatabase(async (db) => {
    const menu = await requireOpenMenu(db, data.menuId, now);
    const subject = await db.user.findUnique({
      where: { id: data.userId },
      select: { id: true, name: true, active: true },
    });
    if (!subject?.active) {
      throw new AppError("Çalışan bulunamadı.", "NOT_FOUND", 404);
    }
    const order = await db.mealOrder.findUnique({
      where: { userId_menuId: { userId: subject.id, menuId: menu.id } },
      select: { status: true, absent: true },
    });
    if (order && order.status !== "CANCELLED" && order.absent) {
      throw new AppError("Ofiste olmadığını bildiren kişiye hatırlatma gönderilmez.", "VALIDATION", 400);
    }
    if (order && order.status !== "CANCELLED") {
      throw new AppError("Bu kişinin siparişi zaten var.", "CONFLICT", 409);
    }
    const link = await db.telegramLink.findFirst({
      where: { userId: subject.id, revokedAt: null },
      select: { chatId: true },
    });
    if (!link) {
      return { delivered: false , message: `${subject.name} için Telegram bağlantısı yok. Hatırlatma gönderilmedi.` };
    }
    const channel = liveTelegramTransport();
    if (channel.delivery !== "live" || !channel.transport) {
      return { delivered: false , message: "Telegram gönderimi kapalı. Hatırlatma gönderilmedi." };
    }
    const day = toIsoDate(menu.date);
    const settings = await db.mealSettings.findUnique({ where: { id: MEAL_SETTINGS_ID }, select: { closesAt: true } });
    const weekday = WEEKDAY_LABELS[istanbulClock(new Date(`${day}T12:00:00+03:00`)).weekday] ?? "";
    const [year, month, date] = day.split("-");
    const result = await deliverTelegram(db, {
      dedupeKey: `meal.remind:${day}:${subject.id}`,
      kind: "meal.remind",
      chatId: link.chatId,
      text: formatMealReminder(subject.name, `${weekday} ${date}.${month}.${year}`, settings?.closesAt ?? DEFAULT_CLOSES_AT),
      delivery: channel.delivery,
      transport: channel.transport,
    });
    const delivered = result.status === "sent" || result.status === "duplicate";
    if (delivered) {
      await db.mealOrderAudit.create({
        data: {
          actorId: actor.id,
          action: "REMIND",
          subjectUserId: subject.id,
          subjectName: subject.name,
          changes: { delivered: result.status === "sent", channel: "telegram", day },
        },
      });
    }
    if (result.status === "sent") {
      return { delivered: true , message: `${subject.name} için hatırlatma Telegram'a gönderildi.` };
    }
    if (result.status === "duplicate") {
      return { delivered: true , message: `${subject.name} için bugünün hatırlatması zaten gönderildi.` };
    }
    return { delivered: false , message: "Hatırlatma gönderilemedi." };
  });
}

export async function getMealSpendReport(actor, year) {
  assertCan(actor, "mealSpend:read");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new AppError("Yıl geçersiz.", "VALIDATION", 400);
  }
  return remember(`meal:spend:${year}`, () => withDatabase(async (db) => {
    const menus = await db.mealMenu.findMany({
      where: { date: { gte: dateOnly(`${year}-01-01`), lte: dateOnly(`${year}-12-31`) } },
      orderBy: { date: "asc" },
      include: {
        orders: {
          select: {
            status: true,
            absent: true,
            user: { select: { id: true, name: true } },
            item: { select: { name: true, price: true } },
            soupItem: { select: { name: true, price: true } },
            sideItem: { select: { name: true, price: true } },
            dessertItem: { select: { name: true, price: true } },
          },
        },
        guestOrders: {
          select: {
            guestName: true,
            item: { select: { name: true, price: true } },
            soupItem: { select: { name: true, price: true } },
            sideItem: { select: { name: true, price: true } },
            dessertItem: { select: { name: true, price: true } },
          },
        },
      },
    });
    const days = menus.map((menu) => {
      const source = [
        ...menu.orders.map((order) => ({
          kind: "employee" ,
          personName: order.user.name,
          userId: order.user.id,
          absent: order.absent,
          status: order.status,
          choices: order.absent ? [] : choiceRows([order.item, order.soupItem, order.sideItem, order.dessertItem]),
        })),
        ...menu.guestOrders.map((order) => ({
          kind: "guest" ,
          personName: order.guestName,
          absent: false,
          status: "RECEIVED",
          choices: choiceRows([order.item, order.soupItem, order.sideItem, order.dessertItem]),
        })),
      ];
      const spend = daySpend(source);
      const date = toIsoDate(menu.date);
      const present = (person) => ({
        personName: person.personName,
        choices: person.choices.map((choice) => choice.name),
        personLabel: personSpendLabel(person),
      });
      return {
        date,
        weekdayLabel: WEEKDAY_LABELS[istanbulClock(new Date(`${date}T12:00:00+03:00`)).weekday] ?? "",
        eaters: spend.eaters,
        missing: spend.missing,
        totalKurus: spend.totalKurus,
        totalLabel: spendLabel(spend.totalKurus, spend.missing),
        absent: spend.absent,
        employeeIds: source.filter((order) => order.kind === "employee" && !order.absent && order.status !== "CANCELLED").map((order) => order.userId).filter((id) => Boolean(id)),
        employees: spend.people.filter((person) => person.kind === "employee").map(present),
        guests: spend.people.filter((person) => person.kind === "guest").map(present),
        orderCount: spend.eaters,
      };
    });
    const recorded = days.filter((day) => day.eaters > 0);
    const grouped = new Map();
    for (const day of recorded) {
      const month = Number(day.date.slice(5, 7));
      grouped.set(month, [...(grouped.get(month) ?? []), day]);
    }
    const months = [...grouped.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([month, monthDays]) => {
        const summary = monthSpend(monthDays);
        const uniqueEmployees = new Set(monthDays.flatMap((day) => day.employeeIds)).size;
        return {
          month,
          label: `${MONTH_LABELS[month - 1]} ${year}`,
          mealDays: summary.mealDays,
          orders: monthDays.reduce((sum, day) => sum + day.orderCount, 0),
          uniqueEmployees,
          participations: summary.eaters,
          missing: summary.missing,
          totalLabel: spendLabel(summary.totalKurus, summary.missing),
          days: monthDays.map((day) => ({
            date: day.date,
            weekdayLabel: day.weekdayLabel,
            eaters: day.eaters,
            missing: day.missing,
            totalLabel: day.totalLabel,
            absent: day.absent,
            employees: day.employees,
            guests: day.guests,
            orderCount: day.orderCount,
          })),
        };
      });
    return { year, months };
  }));
}
