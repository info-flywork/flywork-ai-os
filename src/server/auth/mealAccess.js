import "server-only";
import { redirect } from "next/navigation";

import { AppError } from "@/server/errors";

export function redirectMealOnlyUser(user) {
  if (user.mealOnly) {
    redirect("/yemek-yonetimi");
  }
}

export function redirectEmployeeFromAdminPages(user) {
  if (user.role !== "ADMIN" && !user.mealOnly) {
    redirect("/yemek-yonetimi");
  }
}

export function assertNotMealOnly(actor) {
  if (actor.mealOnly) {
    throw new AppError("Bu işlem için yetkiniz yok.", "FORBIDDEN", 403);
  }
}
