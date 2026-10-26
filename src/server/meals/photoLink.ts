import { AppError } from "@/server/errors";
import { ADILE_SOURCE_SITE, adilePhotoRows } from "@/server/meals/adilePhotoReport";
import { photoNameKey, type PhotoReviewRow } from "@/server/meals/photoMatch";

export type PhotoLinkList = "CONFIRMED" | "MANUAL" | "MISSING";

export type PhotoLinkSource = {
  pageUrl: string;
  imageUrl: string;
};

export type PhotoLinkPlanItem = {
  dishId: string;
  list: PhotoLinkList;
  imageUrl: string | null;
  pageUrl: string | null;
  sources: PhotoLinkSource[];
  sourceSite: string;
  rightsVerified: false;
  reason: string;
  sharedImage: boolean;
};

export type PhotoLinkPlan = {
  confirmed: PhotoLinkPlanItem[];
  manual: PhotoLinkPlanItem[];
  missing: PhotoLinkPlanItem[];
  rightsVerified: false;
};

function linkList(row: PhotoReviewRow): PhotoLinkList {
  if (row.status === "kesin" && row.candidates.length === 1 && !row.sharedImage) {
    return "CONFIRMED";
  }
  if (row.status === "yok" || row.candidates.length === 0) {
    return "MISSING";
  }
  return "MANUAL";
}

export function planDishPhotoLinks(dishes: { id: string; name: string }[]): PhotoLinkPlan {
  const byKey = new Map(adilePhotoRows().map((row) => [row.dishKey, row]));
  const seenIds = new Set<string>();
  const seenKeys = new Map<string, string>();
  const plan: PhotoLinkPlan = { confirmed: [], manual: [], missing: [], rightsVerified: false };

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
    const item: PhotoLinkPlanItem = {
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
