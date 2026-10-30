"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { saveInvoiceAutoRule } from "@/server/services/invoiceAutoRule";

export async function saveInvoiceAutoRuleAction(_state, formData) {
  try {
    const actor = await requireUser();
    const vendors = String(formData.get("vendors") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length >= 2);
    const saved = await saveInvoiceAutoRule(actor, {
      enabled: formData.get("enabled") === "on",
      maxAmount: String(formData.get("maxAmount") ?? "").trim(),
      currency: String(formData.get("currency") ?? "TRY"),
      vendors,
    });
    revalidatePath("/ayarlar");
    revalidatePath("/bildirimler");
    const extra = saved.approved > 0 ? ` ${saved.approved} fatura otomatik onaylandı.` : "";
    return { ok: true, message: `Kural kaydedildi.${extra}` };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}
