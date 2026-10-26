"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { createFeedback, deleteFeedback, reviewFeedback } from "@/server/services/feedback";

 

export async function createFeedbackAction(
  _previous,
  formData,
) {
  try {
    const actor = await requireUser();
    await createFeedback(actor, {
      kind: formData.get("kind"),
      body: formData.get("body"),
    });
    revalidatePath("/oneri");
    return { ok: true, message: "İletiniz kaydedildi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function deleteFeedbackAction(
  _previous,
  formData,
) {
  try {
    const actor = await requireUser();
    await deleteFeedback(actor, { id: formData.get("id") });
    revalidatePath("/oneri");
    return { ok: true, message: "İleti silindi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function reviewFeedbackAction(
  _previous,
  formData,
) {
  try {
    const actor = await requireUser();
    await reviewFeedback(actor, { id: formData.get("id") });
    revalidatePath("/oneri");
    return { ok: true, message: "İncelendi olarak işaretlendi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}
