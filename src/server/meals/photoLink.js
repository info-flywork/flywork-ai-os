import { AppError } from "@/server/errors";
import { ADILE_SOURCE_SITE, adilePhotoRows } from "@/server/meals/adilePhotoReport";
import { photoNameKey } from "@/server/meals/photoMatch";

 

























function linkList(row) {
  if (row.status === "kesin" && row.candidates.length === 1 && !row.sharedImage) {
    return "CONFIRMED";
  }
  if (row.status === "yok" || row.candidates.length === 0) {
    return "MISSING";
  }
  return "MANUAL";
}

export function planDishPhotoLinks(dishes) {
  const byKey = new Map(adilePhotoRows().map((row) => [row.dishKey, row]));
  const seenIds = new Set();
  const seenKeys = new Map();
  const plan = { confirmed: [], manual: [], missing: [], rightsVerified: false };

  for (const dish of dishes) {
    const dishId = dish.id.trim();
    if (!dishId || seenIds.has(dishId)) {
      throw new AppError("Yemek kimliği bir kez kullanılmalı.", "VALIDATION", 400);
    }
    seenIds.add(dishId);
    const row = byKey.get(photoNameKey(dish.name));
    if (!row) {
      continue;
    }
    const previous = seenKeys.get(row.dishKey);
    if (previous) {
      throw new AppError("Aynı ada sahip iki yemek tek fotoğrafa bağlanamaz.", "CONFLICT", 409);
    }
    seenKeys.set(row.dishKey, dishId);
    const sources = row.candidates.map((candidate) => ({
      pageUrl: candidate.pageUrl,
      imageUrl: candidate.imageUrl,
    }));
    const single = sources.length === 1 ? sources[0] : null;
    const item = {
      dishId,
      list: linkList(row),
      imageUrl: single?.imageUrl ?? null,
      pageUrl: single?.pageUrl ?? null,
      sources,
      sourceSite: ADILE_SOURCE_SITE,
      rightsVerified: false,
      reason: row.reason,
      sharedImage: row.sharedImage,
    };
    if (item.list === "CONFIRMED") {
      plan.confirmed.push(item);
    } else if (item.list === "MISSING") {
      plan.missing.push(item);
    } else {
      plan.manual.push(item);
    }
  }

  return plan;
}
