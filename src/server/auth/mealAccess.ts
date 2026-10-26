import "server-only";
import { redirect } from "next/navigation";
import type { Actor } from "@/server/auth/permissions";
import { AppError } from "@/server/errors";

export function redirectMealOnlyUser(user: Pick<Actor, "mealOnly">): void {
  if (user.mealOnly) {
    redirect("/yemek-yonetimi");
  }
}

export function redirectEmployeeFromAdminPages(user: Pick<Actor, "role" | "mealOnly">): void {
  if (user.role !== "ADMIN" && !user.mealOnly) {
    redirect("/yemek-yonetimi");
  }
}

export function assertNotMealOnly(actor: Pick<Actor, "mealOnly">): void {
  if (actor.mealOnly) {
    throw new AppError("Bu işlem için yetkiniz yok.", "FORBIDDEN", 403);
  }
}
