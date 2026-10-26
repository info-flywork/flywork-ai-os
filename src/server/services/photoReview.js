import "server-only";

import { assertCan } from "@/server/auth/permissions";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  ADILE_MENU_SITE,
  ADILE_REPRESENTATIVE_NOTE,
  ADILE_RIGHTS_NOTE,
  ADILE_SOURCE_SITE,
  adilePhotoRows,
  adilePhotoSummary,
} from "@/server/meals/adilePhotoReport";
import { photoPublishBlock } from "@/server/meals/photoMatch";

 













function decisionOf(value) {
  if (value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  return null;
}

export async function listMealPhotoReviews(actor) {
  assertCan(actor, "mealMenu:write");
  const rows = adilePhotoRows();
  const [stored, catalogDishes, grouped] = await withDatabase((db) =>
    Promise.all([
      db.mealPhotoReview.findMany({ select: { dishKey: true, decision: true } }),
      db.mealDish.count(),
      db.mealPhotoLink.groupBy({ by: ["list"], _count: { _all: true } }),
    ]),
  );
  const decisions = new Map(stored.map((item) => [item.dishKey, decisionOf(item.decision)]));
  const photoLinks = { confirmed: 0, manual: 0, missing: 0 };
  for (const group of grouped) {
    if (group.list === "CONFIRMED") {
      photoLinks.confirmed = group._count._all;
    } else if (group.list === "MANUAL") {
      photoLinks.manual = group._count._all;
    } else if (group.list === "MISSING") {
      photoLinks.missing = group._count._all;
    }
  }
  return {
    sourceSite: ADILE_SOURCE_SITE,
    menuSite: ADILE_MENU_SITE,
    rightsNote: ADILE_RIGHTS_NOTE,
    representativeNote: ADILE_REPRESENTATIVE_NOTE,
    rightsVerified: false,
    summary: adilePhotoSummary(rows),
    catalogDishes,
    photoLinks,
    rows: rows.map((row) => ({ ...row, decision: decisions.get(row.dishKey) ?? null })),
  };
}

export async function decideMealPhotoReview(
  actor,
  dishKey,
  decision,
) {
  assertCan(actor, "mealMenu:write");
  const row = adilePhotoRows().find((item) => item.dishKey === dishKey);
  if (!row) {
    throw new AppError("Bu yemek inceleme listesinde yok.", "NOT_FOUND", 404);
  }
  if (decision === "APPROVED" && row.candidates.length !== 1) {
    throw new AppError("Tek görsel yok. Eşleşme onaylanamaz.", "VALIDATION", 400);
  }
  const candidate = row.candidates.length === 1 ? row.candidates[0] : null;
  if (
    photoPublishBlock({
      rightsVerified: false,
      decision,
      candidateCount: row.candidates.length,
      sharedImage: row.sharedImage,
    }) === null
  ) {
    throw new AppError("Fotoğraf yazma kapısı kapalı değil.", "VALIDATION", 400);
  }
  await withDatabase((db) =>
    db.mealPhotoReview.upsert({
      where: { dishKey },
      create: {
        dishKey,
        dishName: row.dishName,
        decision,
        imageUrl: candidate?.imageUrl ?? null,
        pageUrl: candidate?.pageUrl ?? null,
        decidedById: actor.id,
      },
      update: {
        dishName: row.dishName,
        decision,
        imageUrl: candidate?.imageUrl ?? null,
        pageUrl: candidate?.pageUrl ?? null,
        decidedById: actor.id,
      },
    }),
  );
  return {
    published: false,
    message:
      decision === "APPROVED"
        ? "Eşleşme kaydedildi. Kullanım hakkı doğrulanmadığı için fotoğraf kataloğa yazılmadı."
        : "Eşleşme reddedildi. Fotoğraf kataloğa yazılmadı.",
  };
}
