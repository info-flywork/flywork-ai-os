"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { markAlertRead, markVisibleAlertsRead } from "@/server/services/alerts";

function refresh() {
  revalidatePath("/bildirimler");
  revalidatePath("/");
}

export async function markAlertReadAction(formData) {
  const actor = await requireUser();
  await markAlertRead(actor, String(formData.get("key") ?? ""));
  refresh();
}

export async function markAllAlertsReadAction() {
  const actor = await requireUser();
  await markVisibleAlertsRead(actor);
  refresh();
}
