 










function add(map, name) {
  if (!name) {
    return;
  }
  map.set(name, (map.get(name) ?? 0) + 1);
}

function rows(map) {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "tr"));
}

export function mealOrderTotals(orders) {
  const all = new Map();
  const main = new Map();
  const soup = new Map();
  const side = new Map();
  const dessert = new Map();
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
