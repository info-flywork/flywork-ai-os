"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { createUser, deleteUser, setUserActive, updateUser } from "@/server/services/users";

export type ActionState = { ok: boolean; message: string };

export async function createAccountAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    const role = String(formData.get("role") ?? "");
    const mealOnly = formData.get("mealOnly") === "on";
    const startedOn = String(formData.get("startedOn") ?? "");
    if (role === "EMPLOYEE" && !mealOnly && !startedOn) {
      return { ok: false, message: "İşe başlama tarihi gerekli." };
    }
    await createUser(actor, {
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      role,
      mealOnly,
      startedOn,
    });
    revalidatePath("/kullanicilar");
    revalidatePath("/izin");
    return { ok: true, message: "Hesap oluşturuldu." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function updateAccountAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    const password = String(formData.get("password") ?? "");
    const role = String(formData.get("role") ?? "");
    const mealOnly = formData.get("mealOnly") === "on";
    const startedOn = String(formData.get("startedOn") ?? "");
    if (role === "EMPLOYEE" && !mealOnly && !startedOn) {
      return { ok: false, message: "İşe başlama tarihi gerekli." };
    }
    await updateUser(actor, {
      userId: formData.get("userId"),
      name: formData.get("name"),
      email: formData.get("email"),
      role,
      mealOnly,
      password: password.length > 0 ? password : undefined,
      startedOn,
    });
    revalidatePath("/kullanicilar");
    revalidatePath("/izin");
    return { ok: true, message: password.length > 0 ? "Hesap güncellendi ve oturumları kapatıldı." : "Hesap güncellendi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function deleteAccountAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await deleteUser(actor, String(formData.get("userId") ?? ""));
    revalidatePath("/kullanicilar");
    return { ok: true, message: "Hesap silindi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function setActiveAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    const active = formData.get("active") === "true";
    await setUserActive(actor, String(formData.get("userId") ?? ""), active);
    revalidatePath("/kullanicilar");
    return {
      ok: true,
      message: active ? "Hesap yeniden açıldı." : "Hesap kapatıldı ve oturumları sonlandırıldı.",
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}
