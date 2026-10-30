import "server-only";

import { formatIstanbulDateTime } from "@/server/dates";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { assertNotMealOnly } from "@/server/auth/mealAccess";
import { announcementSchema, parseInput } from "@/server/validation/schemas";

function assertStaff(actor) {
  assertNotMealOnly(actor);
  if (actor.role !== "ADMIN" && actor.role !== "EMPLOYEE") {
    throw new AppError("Duyurular bu hesap için kapalı.", "FORBIDDEN", 403);
  }
}

export async function listRecentAnnouncements(actor) {
  assertStaff(actor);
  const rows = await withDatabase((db) => db.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, body: true, createdAt: true },
  }));
  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: formatIstanbulDateTime(row.createdAt),
  }));
}

export async function createAnnouncement(actor, input) {
  assertNotMealOnly(actor);
  if (actor.role !== "ADMIN") {
    throw new AppError("Duyuruyu yalnızca yönetici ekler.", "FORBIDDEN", 403);
  }
  const data = parseInput(announcementSchema, input);
  await withDatabase((db) => db.announcement.create({
    data: { body: data.body, createdById: actor.id },
  }));
}
