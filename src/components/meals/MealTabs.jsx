import Link from "next/link";

export const ADMIN_MEAL_TABS = [
  ["siparis", "Sipariş ver"],
  ["bugun", "Bugünkü siparişler"],
  ["gunluk", "Günlük"],
  ["aylik", "Aylık"],
  ["plan", "Menü planlama"],
  ["katalog", "Yemek kataloğu"],
] ;

export const ORDER_MEAL_TABS = ADMIN_MEAL_TABS.slice(0, 4);

export const EMPLOYEE_MEAL_TABS = [
  ["siparis", "Sipariş ver"],
] ;

 

export function mealTab(value, role) {
  const allowed = role === "ADMIN" ? ADMIN_MEAL_TABS.map(([id]) => id) : EMPLOYEE_MEAL_TABS.map(([id]) => id);
  if (value && allowed.includes(value )) {
    return value ;
  }
  return "siparis";
}

export default function MealTabs({
  tabs,
  active,
  hrefFor,
  onSelect,
  appearance = "default",
}





) {
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
          <Link key={id} className={className} href={hrefFor?.(id) ?? "/yemek-yonetimi"}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}
