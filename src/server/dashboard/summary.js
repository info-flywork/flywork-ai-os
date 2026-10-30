import "server-only";

import { can, assertCan } from "@/server/auth/permissions";
import { dateOnly, formatIstanbulDateTime, istanbulToday, toIsoDate } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { isOwnCompanyName } from "@/server/finance/ownCompany";
import { numberList } from "@/server/jsonList";
import { istanbulClock, MEAL_SETTINGS_ID } from "@/server/meals/schedule";

 




































const EXPENSE_SCOPES = ["EMPLOYEE", "COMPANY", "OFFICE"];
const ORDER_STATUSES = ["RECEIVED", "PREPARING", "DELIVERED", "CANCELLED"];
const CURRENCIES = ["TRY", "USD", "EUR"];

function emptyExpenses() {
  return {
    EMPLOYEE: { total: "0", count: 0 },
    COMPANY: { total: "0", count: 0 },
    OFFICE: { total: "0", count: 0 },
  };
}

function emptyOrders() {
  return { RECEIVED: 0, PREPARING: 0, DELIVERED: 0, CANCELLED: 0 };
}

function monthWindow(iso) {
  const [year, month] = iso.split("-");
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    label: `${year}-${month}`,
    start: dateOnly(`${year}-${month}-01`),
    end: dateOnly(`${year}-${month}-${String(lastDay).padStart(2, "0")}`),
  };
}

export function invoiceReviewMonthWhere(monthLabel) {
  const [yearText, monthText] = monthLabel.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const issuedStart = dateOnly(`${yearText}-${monthText}-01`);
  const issuedEnd = dateOnly(`${yearText}-${monthText}-${String(lastDay).padStart(2, "0")}`);
  const createdStart = new Date(`${yearText}-${monthText}-01T00:00:00+03:00`);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const createdEnd = new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+03:00`);
  return {
    OR: [
      { issuedOn: { gte: issuedStart, lte: issuedEnd } },
      { issuedOn: null, createdAt: { gte: createdStart, lt: createdEnd } },
    ],
  };
}

function currencyReport(rows) {
  const totals = new Map();
  for (const code of CURRENCIES) {
    totals.set(code, { total: 0, count: 0 });
  }
  for (const row of rows) {
    const current = totals.get(row.currency) ?? { total: 0, count: 0 };
    current.total += Number(row.amount.toString());
    current.count += 1;
    totals.set(row.currency, current);
  }
  const extra = [...totals.keys()].filter((code) => !CURRENCIES.includes(code)).sort();
  return [...CURRENCIES, ...extra].map((currency) => {
    const value = totals.get(currency) ?? { total: 0, count: 0 };
    return { currency, total: value.total.toFixed(2), count: value.count };
  });
}

export async function getDashboardSummary(actor, now = new Date()) {
  assertCan(actor, "dashboard:self");
  const company = can(actor.role, "dashboard:company");
  const todayIso = istanbulToday(now);
  const today = dateOnly(todayIso);
  const horizon = new Date(today.getTime() + 30 * 86_400_000);
  const month = monthWindow(todayIso);
  const ownerFilter = company ? {} : { userId: actor.id };
  const serviceDay = istanbulClock(now).weekday;

  return withDatabase(async (db) => {
    const settings = await db.mealSettings.findUnique({
      where: { id: MEAL_SETTINGS_ID },
      select: { weekdays: true },
    });
    const weekdays = numberList(settings?.weekdays);
    const serviceWeekdays = weekdays.length ? weekdays : [1, 2, 4];
    const [expenses, monthRows, orders, menu, awayToday, pendingCount, pendingRequests, renewals, overdueRenewals, invoicesPending, recentRuns] =
      await Promise.all([
        db.expense.groupBy({
          by: ["scope"],
          where: { status: { in: ["APPROVED", "PAID"] }, ...ownerFilter },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        db.expense.findMany({
          where: {
            status: { in: ["APPROVED", "PAID"] },
            spentOn: { gte: month.start, lte: month.end },
            ...ownerFilter,
          },
          select: { amount: true, currency: true },
        }),
        db.mealOrder.groupBy({
          by: ["status"],
          where: { menu: { date: today }, ...ownerFilter },
          _count: { _all: true },
        }),
        db.mealMenu.findUnique({
          where: { date: today },
          select: {
            published: true,
            items: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true } },
            orders: {
              where: {
                status: { not: "CANCELLED" },
                ...(company ? {} : { userId: actor.id }),
              },
              select: {
                userId: true,
                absent: true,
                item: { select: { name: true } },
                soupItem: { select: { name: true } },
                sideItem: { select: { name: true } },
                dessertItem: { select: { name: true } },
              },
            },
          },
        }),
        db.leaveRequest.count({
          where: {
            status: "APPROVED",
            startDate: { lte: today },
            endDate: { gte: today },
            ...ownerFilter,
          },
        }),
        db.leaveRequest.count({ where: { status: "PENDING", ...ownerFilter } }),
        db.leaveRequest.findMany({
          where: { status: "PENDING", ...ownerFilter },
          orderBy: { startDate: "asc" },
          take: 5,
          select: {
            id: true,
            type: true,
            startDate: true,
            user: { select: { name: true } },
          },
        }),
        company
          ? db.technologySubscription.findMany({
              where: { active: true, renewsOn: { gte: today, lte: horizon } },
              orderBy: { renewsOn: "asc" },
              take: 5,
              select: { id: true, name: true, renewsOn: true },
            })
          : Promise.resolve([]),
        company
          ? db.technologySubscription.count({ where: { active: true, renewsOn: { lt: today } } })
          : Promise.resolve(0),
        company
          ? db.invoiceReview.findMany({
              where: {
                status: "PENDING",
                documentType: { not: "STATEMENT" },
                ...invoiceReviewMonthWhere(month.label),
              },
              select: { vendor: true },
            }).then((rows) => rows.filter((row) => !isOwnCompanyName(row.vendor)).length)
          : Promise.resolve(null),
        company
          ? db.automationRun.findMany({
              orderBy: { startedAt: "desc" },
              take: 5,
              select: {
                id: true,
                state: true,
                summary: true,
                error: true,
                startedAt: true,
                job: { select: { name: true } },
              },
            })
          : Promise.resolve(null),
      ]);

    const expensesByScope = emptyExpenses();
    for (const row of expenses) {
      if (!EXPENSE_SCOPES.includes(row.scope)) {
        continue;
      }
      expensesByScope[row.scope] = {
        total: row._sum.amount?.toString() ?? "0",
        count: row._count._all,
      };
    }

    const mealOrdersToday = emptyOrders();
    for (const row of orders) {
      if (!ORDER_STATUSES.includes(row.status)) {
        continue;
      }
      mealOrdersToday[row.status] = row._count._all;
    }

    const counts = new Map();
    for (const item of menu?.items ?? []) {
      counts.set(item.name, 0);
    }
    let ownItem = null;
    for (const order of menu?.orders ?? []) {
      const names = order.absent
        ? []
        : [order.item?.name, order.soupItem?.name, order.sideItem?.name, order.dessertItem?.name].filter((name) => Boolean(name));
      for (const name of names) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      if (order.userId === actor.id) {
        ownItem = order.absent ? "Ofiste değil" : names.join(" · ") || null;
      }
    }

    return {
      source: "database",
      scope: company ? "company" : "self",
      month: month.label,
      expensesByScope,
      monthlyExpenses: currencyReport(monthRows),
      mealOrdersToday,
      meal: {
        serviceDay: serviceWeekdays.includes(serviceDay),
        published: menu?.published ?? false,
        total: menu?.orders.length ?? 0,
        ownItem,
        items: [...counts.entries()].map(([name, count]) => ({ name, count })),
      },
      leave: {
        awayToday,
        pending: pendingCount,
        requests: pendingRequests.map((request) => ({
          id: request.id,
          name: company ? request.user.name : "Sizin talebiniz",
          type: request.type,
          startDate: toIsoDate(request.startDate),
        })),
      },
      invoicesPending,
      upcomingRenewals: renewals.map((item) => ({
        id: item.id,
        name: item.name,
        renewsOn: toIsoDate(item.renewsOn),
        daysUntil: Math.round((item.renewsOn.getTime() - today.getTime()) / 86_400_000),
      })),
      overdueRenewals,
      recentRuns: recentRuns
        ? recentRuns.map((run) => ({
            id: run.id,
            jobName: run.job.name,
            state: run.state,
            summary: run.summary.slice(0, 180),
            error: run.error,
            startedAt: formatIstanbulDateTime(run.startedAt),
          }))
        : null,
    };
  });
}
