"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { dismissAlert, dismissVisibleAlerts, markAlertRead, markVisibleAlertsRead } from "@/server/services/alerts";

function refresh() {
  revalidatePath("/bildirimler");
  revalidatePath("/");
}

export async function markAlertReadAction(formData) {
  const actor = await requireUser();
  await markAlertRead(actor, String(formData.get("key") ?? ""));
  refresh();
}

export async function dismissAlertAction(formData) {
  const actor = await requireUser();
  await dismissAlert(actor, String(formData.get("key") ?? ""));
  refresh();
}

export async function dismissVisibleAlertsAction(formData) {
  const actor = await requireUser();
  const level = String(formData.get("level") ?? "action");
  await dismissVisibleAlerts(actor, new Date(), level === "info" ? "info" : "action");
  refresh();
}

export async function markAllAlertsReadAction(formData) {
  const actor = await requireUser();
  const level = String(formData.get("level") ?? "action");
  await markVisibleAlertsRead(actor, new Date(), level === "info" ? "info" : "action");
  refresh();
}
