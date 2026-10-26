export type MealChoice = {
  id: string;
  slot: "MAIN" | "SOUP" | "SIDE" | "DESSERT" | null;
  available?: boolean;
  choiceKey?: string | null;
};

export type MealSelectionInput = {
  absent?: boolean;
  itemId?: string | null;
  mainItemId?: string | null;
  soupItemId?: string | null;
  sideItemId?: string | null;
  dessertItemId?: string | null;
  note?: string | null;
};

export type MealSelection =
  | {
      ok: true;
      absent: boolean;
      itemId: string | null;
      soupItemId: string | null;
      sideItemId: string | null;
      dessertItemId: string | null;
      note: string | null;
    }
  | { ok: false; message: string };

export function mealGroup(choiceKey: string | null | undefined): { key: string; mode: "and" | "or" | "salad" } {
  const raw = choiceKey?.split("|")[0]?.trim() ?? "";
  if (raw.endsWith(":salad")) {
    return { key: raw.slice(0, -6), mode: "salad" };
  }
  if (raw.endsWith(":or")) {
    return { key: raw.slice(0, -3), mode: "or" };
  }
  return { key: raw, mode: "and" };
}

export function sharesGroup(choiceKey: string | null | undefined, key: string) {
  return key.length > 0 && (choiceKey ?? "").split("|").includes(key);
}

function clean(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text.length > 0 ? text : null;
}

export function resolveMealSelection(items: MealChoice[], input: MealSelectionInput): MealSelection {
  const note = clean(input.note);
  if (note && note.length > 300) {
    return { ok: false, message: "Sipariş notu 300 karakteri aşamaz." };
  }
  if (input.absent) {
    return { ok: true, absent: true, itemId: null, soupItemId: null, sideItemId: null, dessertItemId: null, note };
  }

  const slotted = items.some((item) => item.slot);
  const mainId = clean(input.mainItemId) ?? clean(input.itemId);
  const soupId = clean(input.soupItemId);
  const sideId = clean(input.sideItemId);
  const dessertId = clean(input.dessertItemId);

  if (!slotted) {
    const legacy = items.find((item) => item.id === mainId);
    if (!mainId || !legacy) {
      return { ok: false, message: "Seçilen yemek bu menüde yok." };
    }
    if (legacy.available === false) {
      return { ok: false, message: "Seçtiğiniz yemek menüden çıkarıldı. Yeni seçim yapın." };
    }
    if (soupId || sideId || dessertId) {
      return { ok: false, message: "Bu menüde çorba ve garnitür seçimi yok." };
    }
    return { ok: true, absent: false, itemId: mainId, soupItemId: null, sideItemId: null, dessertItemId: null, note };
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const main = mainId ? byId.get(mainId) : undefined;
  if (!main || main.slot !== "MAIN") {
    return { ok: false, message: "Ana yemek seçilmelidir." };
  }
  if (main.available === false) {
    return { ok: false, message: "Seçtiğiniz yemek menüden çıkarıldı. Yeni seçim yapın." };
  }
  const group = mealGroup(main.choiceKey);
  const groupKey = group.key;
  if (!groupKey) {
    if (!soupId || !sideId) {
      return { ok: false, message: "Ana yemek, çorba ve garnitür seçilmelidir." };
    }
  }
  const shares = (item: MealChoice | undefined) => sharesGroup(item?.choiceKey, groupKey);
  const groupSoups = groupKey ? items.filter((item) => item.slot === "SOUP" && item.available !== false && shares(item)) : [];
  const groupSides = groupKey ? items.filter((item) => item.slot === "SIDE" && item.available !== false && shares(item)) : [];
  const soup = soupId ? byId.get(soupId) : undefined;
  const side = sideId ? byId.get(sideId) : undefined;
  const dessert = dessertId ? byId.get(dessertId) : undefined;
  if (groupKey && (group.mode === "or" || group.mode === "salad")) {
    const salad = group.mode === "salad";
    const pickedSoup = Boolean(soup && soup.slot === "SOUP" && shares(soup));
    const pickedSide = Boolean(side && side.slot === "SIDE" && shares(side));
    if (soupId && !pickedSoup) {
      return { ok: false, message: "Bu yemekte listelenen çorbalardan biri seçilmelidir." };
    }
    if (sideId && !pickedSide) {
      return { ok: false, message: salad ? "Bu yemekte yalnızca salata seçilebilir." : "Pilav olarak yalnızca pirinç veya bulgur seçilebilir." };
    }
    if (pickedSoup && pickedSide) {
      return { ok: false, message: salad ? "Çorba ve salata birlikte seçilemez. Birini seçin." : "Pilav ve çorba birlikte seçilemez. Birini seçin." };
    }
    if (!pickedSoup && !pickedSide) {
      return { ok: false, message: salad ? "Bu yemekte çorba ya da salata seçilmelidir." : "Bu yemekte pilav ya da çorba seçilmelidir." };
    }
  } else if (groupKey) {
    if (groupSoups.length > 0 && (!soup || soup.slot !== "SOUP" || !shares(soup))) {
      return { ok: false, message: "Bu yemeğin yanında listelenen çorbalardan biri seçilmelidir." };
    }
    if (groupSoups.length === 0 && soupId) {
      return { ok: false, message: "Bu menüde ayrıca çorba seçimi yok." };
    }
    if (groupSides.length > 0 && (!side || side.slot !== "SIDE" || !shares(side))) {
      return { ok: false, message: "Bu yemeğin yanında listelenen garnitürlerden biri seçilmelidir." };
    }
    if (groupSides.length === 0 && sideId) {
      return { ok: false, message: "Bu menüde ayrıca garnitür seçimi yok." };
    }
  } else if (!soup || soup.slot !== "SOUP" || !side || side.slot !== "SIDE") {
    return { ok: false, message: "Seçimler menüdeki gruplarla eşleşmiyor." };
  }
  const chosen = [mainId, soupId, sideId, dessertId].filter((id): id is string => Boolean(id));
  if (new Set(chosen).size !== chosen.length) {
    return { ok: false, message: "Aynı ürün birden fazla kez seçilemez." };
  }
  if ([soup, side, dessert].some((item) => item?.available === false)) {
    return { ok: false, message: "Seçtiğiniz yemek menüden çıkarıldı. Yeni seçim yapın." };
  }
  if (dessertId && (!dessert || dessert.slot !== "DESSERT")) {
    return { ok: false, message: "Tatlı seçimi menüdeki tatlılarla eşleşmiyor." };
  }
  return {
    ok: true,
    absent: false,
    itemId: mainId,
    soupItemId: soup?.slot === "SOUP" ? soupId ?? null : null,
    sideItemId: side?.slot === "SIDE" ? sideId ?? null : null,
    dessertItemId: dessertId ?? null,
    note,
  };
}
