export type MealOrderParts = {
  status: string;
  absent?: boolean;
  item?: { name: string } | null;
  soupItem?: { name: string } | null;
  sideItem?: { name: string } | null;
  dessertItem?: { name: string } | null;
};

export type MealTotalRow = { name: string; count: number };

function add(map: Map<string, number>, name: string | undefined) {
  if (!name) {
    return;
  }
  map.set(name, (map.get(name) ?? 0) + 1);
}

function rows(map: Map<string, number>): MealTotalRow[] {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "tr"));
}

export function mealOrderTotals(orders: MealOrderParts[]) {
  const all = new Map<string, number>();
  const main = new Map<string, number>();
  const soup = new Map<string, number>();
  const side = new Map<string, number>();
  const dessert = new Map<string, number>();
  let absent = 0;
  for (const order of orders) {
    if (order.status === "CANCELLED") {
      continue;
    }
    if (order.absent) {
      absent += 1;
      continue;
    }
    add(all, order.item?.name);
    add(all, order.soupItem?.name);
    add(all, order.sideItem?.name);
    add(all, order.dessertItem?.name);
    add(main, order.item?.name);
    add(soup, order.soupItem?.name);
    add(side, order.sideItem?.name);
    add(dessert, order.dessertItem?.name);
  }
  return {
    rows: rows(all),
    main: rows(main),
    soup: rows(soup),
    side: rows(side),
    dessert: rows(dessert),
    absent,
  };
}
