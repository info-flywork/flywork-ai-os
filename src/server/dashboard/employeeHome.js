import "server-only";

import { dateOnly, istanbulToday } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { assertNotMealOnly } from "@/server/auth/mealAccess";
import { getEmployeeLeaveView } from "@/server/services/leave";
import { listRecentAnnouncements } from "@/server/services/announcements";
import { getWorkPulse } from "@/server/dashboard/workPulse";

const LEAVE_LABELS = {
  ANNUAL: "Yıllık izin",
  SICK: "Rapor",
  EXCUSE: "Mazeret",
  UNPAID: "Ücretsiz izin",
};

async function ownMeal(actor) {
  const today = dateOnly(istanbulToday());
  const order = await withDatabase((db) => db.mealOrder.findFirst({
    where: { userId: actor.id, status: { not: "CANCELLED" }, menu: { date: today } },
    select: {
      absent: true,
      item: { select: { name: true } },
      soupItem: { select: { name: true } },
      sideItem: { select: { name: true } },
      dessertItem: { select: { name: true } },
    },
  }));
  if (!order) return { ordered: false, label: "" };
  if (order.absent) return { ordered: true, label: "Ofiste değil" };
  const label = [order.item?.name, order.soupItem?.name, order.sideItem?.name, order.dessertItem?.name].filter(Boolean).join(" · ");
  return { ordered: true, label: label || "Sipariş verildi" };
}

async function ownLeave(actor) {
  const view = await getEmployeeLeaveView(actor);
  const pending = view.requests.find((request) => request.status === "PENDING") ?? null;
  return {
    remaining: view.balance?.remainingDays ?? null,
    pending: pending
      ? {
          label: LEAVE_LABELS[pending.type] ?? pending.type,
          startDate: pending.startDate,
          endDate: pending.endDate,
        }
      : null,
  };
}

export async function getEmployeeHome(actor) {
  assertNotMealOnly(actor);
  if (actor.role !== "EMPLOYEE") {
    throw new AppError("Bu sayfa çalışan ana sayfasıdır.", "FORBIDDEN", 403);
  }
  const [pulse, meal, leave, announcements] = await Promise.all([
    getWorkPulse(actor),
    ownMeal(actor).catch(() => ({ ordered: false, label: "" })),
    ownLeave(actor).catch(() => ({ remaining: null, pending: null })),
    listRecentAnnouncements(actor).catch(() => []),
  ]);
  return {
    today: pulse.today,
    focus: pulse.focus,
    choices: pulse.choices,
    attention: pulse.attention,
    jobs: pulse.jobs,
    doingCount: pulse.doingCount,
    review: pulse.review,
    week: pulse.week,
    meal,
    leave,
    announcements,
  };
}
