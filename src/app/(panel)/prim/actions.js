"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { deleteBonusAward, saveBonusAward, saveBonusCriterion, setBonusAwardPaid, setBonusCriterionActive } from "@/server/services/bonus";

 

function finish(error) {
  unstable_rethrow(error);
  return { ok: false, message: toPublicError(error).message };
}

function lira(value) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (/^\d{1,10}$/.test(raw)) return `${raw}.00`;
  if (/^\d{1,10},\d{1,2}$/.test(raw)) {
    const [whole, fraction] = raw.split(",");
    return `${whole}.${fraction.padEnd(2, "0")}`;
  }
  if (/^\d{1,10}\.\d{1,2}$/.test(raw)) {
    const [whole, fraction] = raw.split(".");
    return `${whole}.${fraction.padEnd(2, "0")}`;
  }
  return raw;
}

function days(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export async function saveCriterionAction(_previous, formData) {
  try {
    const actor = await requireUser();
    const id = String(formData.get("id") ?? "").trim();
    await saveBonusCriterion(actor, {
      ...(id ? { id } : {}),
      name: String(formData.get("name") ?? ""),
      defaultAmount: lira(formData.get("defaultAmount")),
    });
    revalidatePath("/prim");
    return { ok: true, message: id ? "Kriter güncellendi." : "Kriter eklendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function setCriterionActiveAction(formData) {
  const actor = await requireUser();
  await setBonusCriterionActive(actor, String(formData.get("id") ?? ""), formData.get("active") === "true");
  revalidatePath("/prim");
}

export async function saveAwardAction(_previous, formData) {
  try {
    const actor = await requireUser();
    const id = String(formData.get("id") ?? "").trim();
    const dayCount = days(formData.get("days"));
    if (typeof dayCount === "number" && Number.isNaN(dayCount)) {
      return { ok: false, message: "Süre gün sayısı olmalı." };
    }
    await saveBonusAward(actor, {
      ...(id ? { id } : {}),
      criterionId: String(formData.get("criterionId") ?? ""),
      title: String(formData.get("title") ?? ""),
      month: String(formData.get("month") ?? ""),
      amount: lira(formData.get("amount")),
      paid: formData.get("paid") === "on",
      ...(dayCount === undefined ? {} : { days: dayCount }),
      note: String(formData.get("note") ?? "").trim() || undefined,
      userIds: formData.getAll("userId").map(String),
    });
    revalidatePath("/prim");
    return { ok: true, message: id ? "Prim güncellendi." : "Prim eklendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function setAwardPaidAction(formData) {
  const actor = await requireUser();
  await setBonusAwardPaid(actor, String(formData.get("id") ?? ""), formData.get("paid") === "true");
  revalidatePath("/prim");
}

export async function deleteAwardAction(formData) {
  const actor = await requireUser();
  await deleteBonusAward(actor, String(formData.get("id") ?? ""));
  revalidatePath("/prim");
}
