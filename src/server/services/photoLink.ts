import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/server/auth/permissions";
import { assertCan } from "@/server/auth/permissions";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { planDishPhotoLinks, type PhotoLinkPlanItem } from "@/server/meals/photoLink";

export async function saveDishPhotoLink(
  actor: Actor,
  dishId: string,
): Promise<{ published: false; dishId: string; list: PhotoLinkPlanItem["list"] }> {
  assertCan(actor, "mealMenu:write");
  const dish = await withDatabase((db) =>
    db.mealDish.findUnique({
      where: { id: dishId },
      select: { id: true, name: true, photoKey: true },
    }),
  );
  if (!dish) {
    throw new AppError("Yemek kaydı yok.", "NOT_FOUND", 404);
  }
  const plan = planDishPhotoLinks([dish]);
  const item = [...plan.confirmed, ...plan.manual, ...plan.missing].find((entry) => entry.dishId === dish.id);
  if (!item || item.rightsVerified) {
    throw new AppError("Bu yemek fotoğraf listesinde yok.", "NOT_FOUND", 404);
  }
  const data = {
    list: item.list,
    imageUrl: item.imageUrl,
    pageUrl: item.pageUrl,
    sources: item.sources as Prisma.InputJsonValue,
    sourceSite: item.sourceSite,
    rightsVerified: false,
    reason: item.reason,
    sharedImage: item.sharedImage,
  };
  await withDatabase((db) =>
    db.mealPhotoLink.upsert({
      where: { dishId: dish.id },
      create: { dishId: dish.id, ...data },
      update: data,
    }),
  );
  const savedDish = await withDatabase((db) =>
    db.mealDish.findUnique({ where: { id: dish.id }, select: { photoKey: true } }),
  );
  if (savedDish?.photoKey !== dish.photoKey) {
    throw new AppError("Fotoğraf kataloğa yazılamaz.", "VALIDATION", 400);
  }
  return { published: false, dishId: dish.id, list: item.list };
}
