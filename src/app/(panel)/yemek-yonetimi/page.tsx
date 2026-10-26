import AdminMeal from "@/components/meals/AdminMeal";
import EmployeeMeal from "@/components/meals/EmployeeMeal";
import { mealTab } from "@/components/meals/MealTabs";
import { istanbulToday } from "@/server/dates";
import { DEFAULT_MEAL_WEEKDAYS, upcomingMealDates } from "@/server/meals/schedule";
import { requireUser } from "@/server/auth/session";
import { isTelegramLinked } from "@/server/telegram/pairing";
import {
  getAdminMealView,
  getEmployeeMealView,
  getMealSpendReport,
  listMealCatalog,
  type MealReportMode,
} from "@/server/services/meals";
import { listMealPhotoReviews } from "@/server/services/photoReview";

function selectedDate(value: string | undefined, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return fallback;
  }
  return value;
}

function selectedMode(value: string | undefined): MealReportMode {
  if (value === "hafta") {
    return "week";
  }
  if (value === "ay") {
    return "month";
  }
  return "day";
}

function selectedYear(value: string | undefined, today: string) {
  const year = Number(value ?? today.slice(0, 4));
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : Number(today.slice(0, 4));
}

function selectedMonth(value: string | undefined) {
  if (!value) {
    return null;
  }
  const month = Number(value);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

export default async function YemekYonetimiPage({
  searchParams,
}: {
  searchParams: Promise<{ tarih?: string; rapor?: string; sekme?: string; yil?: string; ay?: string }>;
}) {
  const user = await requireUser();
  const telegramLinked = await isTelegramLinked(user.id);
  const params = await searchParams;
  const tab = mealTab(params.sekme, user.role);

  if (user.role !== "ADMIN") {
    const view = await getEmployeeMealView(user);
    return (
      <EmployeeMeal
        today={view.today}
        days={view.days}
        telegramLinked={telegramLinked}
      />
    );
  }

  const today = istanbulToday();
  const requested = selectedDate(params.tarih, today);
  const upcoming = upcomingMealDates(today, [...DEFAULT_MEAL_WEEKDAYS], 6);
  const date = upcoming.includes(requested) ? requested : (upcoming[0] ?? requested);
  const year = selectedYear(params.yil, today);
  const [view, catalog, orderView, spend, photoReview] = await Promise.all([
    getAdminMealView(user, date, selectedMode(params.rapor)),
    listMealCatalog(user),
    getEmployeeMealView(user),
    getMealSpendReport(user, year),
    params.sekme === "fotograflar" ? listMealPhotoReviews(user) : Promise.resolve(null),
  ]);

  return (
    <AdminMeal
      view={view}
      tab={params.sekme === "fotograflar" ? "katalog" : tab}
      catalog={catalog.map((category) => ({
        ...category,
        dishes: category.dishes.map((dish) => ({
          ...dish,
          priceLabel: dish.priceLabel ?? null,
        })),
      }))}
      reviewing={params.sekme === "fotograflar"}
      photoReview={photoReview}
      orderView={orderView}
      spend={spend}
      spendYear={year}
      spendMonth={selectedMonth(params.ay)}
      canManage={user.approver !== false}
      telegramLinked={telegramLinked}
    />
  );
}
