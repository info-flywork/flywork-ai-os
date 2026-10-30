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

} from "@/server/services/meals";
import { listMealPhotoReviews } from "@/server/services/photoReview";
export const instant = false;

function selectedDate(value, fallback) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return fallback;
  }
  return value;
}

function selectedMode(value) {
  if (value === "hafta") {
    return "week";
  }
  if (value === "ay") {
    return "month";
  }
  return "day";
}

function selectedYear(value, today) {
  const year = Number(value ?? today.slice(0, 4));
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : Number(today.slice(0, 4));
}

function selectedMonth(value) {
  if (!value) {
    return null;
  }
  const month = Number(value);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

export default async function YemekYonetimiPage({
  searchParams,
}

) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const telegramPromise = isTelegramLinked(user.id);
  const tab = mealTab(params.sekme, user.role);

  if (user.role !== "ADMIN") {
    const [view, telegramLinked] = await Promise.all([getEmployeeMealView(user), telegramPromise]);
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
  const needsOrder = tab === "siparis";
  const needsAdmin = tab === "bugun" || tab === "plan";
  const needsCatalog = tab === "plan" || tab === "katalog" || params.sekme === "fotograflar";
  const needsSpend = tab === "gunluk" || tab === "aylik";
  const [view, catalog, orderView, spend, photoReview, telegramLinked] = await Promise.all([
    needsAdmin ? getAdminMealView(user, date, selectedMode(params.rapor)) : Promise.resolve(null),
    needsCatalog ? listMealCatalog(user) : Promise.resolve([]),
    needsOrder ? getEmployeeMealView(user) : Promise.resolve(null),
    needsSpend ? getMealSpendReport(user, year) : Promise.resolve(null),
    params.sekme === "fotograflar" ? listMealPhotoReviews(user) : Promise.resolve(null),
    telegramPromise,
  ]);
  const mealView = view ?? {
    today,
    selectedDate: date,
    schedule: {
      opensAt: "",
      closesAt: "",
      weekdays: [...DEFAULT_MEAL_WEEKDAYS],
      weekdayLabels: [],
      catererPhone: null,
    },
    window: { allowed: false, message: "" },
    menu: null,
    orders: [],
    guests: [],
    people: [],
    pending: [],
    away: [],
  };

  return (
    <AdminMeal
      view={mealView}
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
