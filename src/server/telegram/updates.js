import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/server/db";

export function telegramUpdateId(update) {
  if (!update || typeof update !== "object" || !("update_id" in update)) {
    return null;
  }
  const value = update.update_id;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return String(value);
}

export async function claimTelegramUpdate(updateId) {
  try {
    await getPrisma().telegramUpdateReceipt.create({ data: { updateId } });
    return "new";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return "duplicate";
    }
    throw error;
  }
}
