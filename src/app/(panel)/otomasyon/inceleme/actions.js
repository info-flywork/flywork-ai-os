"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { draftFromForm } from "@/server/finance/reviewRules";
import { decideInvoiceReview } from "@/server/services/invoiceReview";

export async function decideReviewAction(formData) {
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id || (decision !== "approve" && decision !== "reject" && decision !== "hold")) {
    return;
  }
  try {
    const actor = await requireUser();
    const result = await decideInvoiceReview(actor, id, decision, draftFromForm(formData));
    revalidatePath("/otomasyon");
    revalidatePath("/otomasyon/inceleme");
    revalidatePath(`/otomasyon/inceleme/${id}`);
    const durum = result.outcome === "approved"
      ? "onay"
      : result.outcome === "already"
        ? "zaten"
        : result.outcome === "drive-failed"
          ? "drive"
          : result.outcome === "held"
            ? "beklet"
            : "red";
    redirect(`/otomasyon/inceleme/${id}?durum=${durum}`);
  } catch (error) {
    unstable_rethrow(error);
    const durum = error instanceof AppError && error.code === "CONFLICT"
      ? "mukerrer"
      : error instanceof AppError && error.code === "VALIDATION"
        ? "eksik"
        : error instanceof AppError && error.code === "FORBIDDEN"
          ? "yetki"
          : "hata";
    redirect(id ? `/otomasyon/inceleme/${id}?durum=${durum}` : "/otomasyon/inceleme?durum=hata");
  }
}
