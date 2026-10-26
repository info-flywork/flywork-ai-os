export const ADMIN_MEAL_TABS = [
  ["siparis", "Sipariş ver"],
  ["bugun", "Bugünkü siparişler"],
  ["gunluk", "Günlük"],
  ["aylik", "Aylık"],
  ["plan", "Menü planlama"],
  ["katalog", "Yemek kataloğu"],
] as const;

export const ORDER_MEAL_TABS = ADMIN_MEAL_TABS.slice(0, 4);

export const EMPLOYEE_MEAL_TABS = [
  ["siparis", "Sipariş ver"],
] as const;

export type MealTab = (typeof ADMIN_MEAL_TABS)[number][0] | (typeof EMPLOYEE_MEAL_TABS)[number][0];

export function mealTab(value: string | undefined, role: "ADMIN" | "EMPLOYEE"): MealTab {
  const allowed = role === "ADMIN" ? ADMIN_MEAL_TABS.map(([id]) => id) : EMPLOYEE_MEAL_TABS.map(([id]) => id);
  if (value && allowed.includes(value as never)) {
    return value as MealTab;
  }
  return "siparis";
}

export default function MealTabs({
  tabs,
  active,
  hrefFor,
  onSelect,
  appearance = "default",
}: {
  tabs: readonly (readonly [MealTab, string])[];
  active: MealTab | "fotograflar";
  hrefFor?: (tab: MealTab) => string;
  onSelect?: (tab: MealTab) => void;
  appearance?: "default" | "meal";
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map(([id, label]) => {
        const className = appearance === "meal"
          ? id === active
            ? "inline-flex min-h-10 items-center rounded-full bg-[#03624c] px-4 text-sm font-semibold text-white no-underline"
            : "inline-flex min-h-10 items-center rounded-full bg-[#eef1f4] px-4 text-sm font-semibold text-slate-600 no-underline"
          : id === active ? "btn-primary" : "btn-secondary";
        if (onSelect) {
          return (
            <button key={id} type="button" className={className} onClick={() => onSelect(id)}>
              {label}
            </button>
          );
        }
        return (
          <a key={id} className={className} href={hrefFor?.(id) ?? "/yemek-yonetimi"}>
            {label}
          </a>
        );
      })}
    </div>
  );
}
