"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { markAlertRead, markVisibleAlertsRead } from "@/server/services/alerts";

function refresh() {
  revalidatePath("/bildirimler");
  revalidatePath("/");
}

export async function markAlertReadAction(formData: FormData) {
  const actor = await requireUser();
  await markAlertRead(actor, String(formData.get("key") ?? ""));
  refresh();
}

export async function markAllAlertsReadAction(): Promise<void> {
  const actor = await requireUser();
  await markVisibleAlertsRead(actor);
  refresh();
}
