"use server";

import { unstable_rethrow } from "next/navigation";
import { changeOwnPasswordFromSession } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";

 

export async function changeOwnPasswordAction(
  _previous,
  formData,
) {
  try {
    await changeOwnPasswordFromSession({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });
    return { ok: true, message: "Şifre değişti. Bu oturum açık kaldı." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}
