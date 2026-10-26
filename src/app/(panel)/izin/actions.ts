"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import {
  addLeaveHoliday,
  cancelOwnLeaveRequest,
  createLeaveRequest,
  reverseLeaveApproval,
  reviewLeaveRequest,
  settleLeaveRequest,
  setLeaveBalance,
  setLeaveHolidayActive,
  updateLeaveCalendar,
  type LeaveFile,
} from "@/server/services/leave";

export type ActionState = { ok: boolean; message: string };

function finish(error: unknown): ActionState {
  unstable_rethrow(error);
  return { ok: false, message: toPublicError(error).message };
}

async function readFile(formData: FormData): Promise<LeaveFile | null> {
  const value = formData.get("document");
  if (!(value instanceof File) || value.size === 0) {
    return null;
  }
  return {
    bytes: Buffer.from(await value.arrayBuffer()),
    fileName: value.name,
    contentType: value.type,
  };
}

export async function createLeaveAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    const duration = String(formData.get("duration") ?? "");
    const startDate = String(formData.get("startDate") ?? "");
    const endDate = duration === "MULTI_DAY" ? String(formData.get("endDate") ?? "") : startDate;
    const created = await createLeaveRequest(
      actor,
      {
        type: formData.get("type"),
        duration,
        startDate,
        endDate,
        startTime: String(formData.get("startTime") ?? "") || undefined,
        endTime: String(formData.get("endTime") ?? "") || undefined,
        reason: String(formData.get("reason") ?? "").trim() || undefined,
      },
      await readFile(formData),
    );
    revalidatePath("/izin");
    revalidatePath("/");
    return {
      ok: true,
      message: created.adminNotified
        ? "İzin talebi kaydedildi. Yöneticiye Telegram'dan iletildi."
        : "İzin talebi kaydedildi. Yönetici Telegram'ı bağlı değil.",
    };
  } catch (error) {
    return finish(error);
  }
}

export async function cancelLeaveAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await cancelOwnLeaveRequest(actor, String(formData.get("requestId") ?? ""));
    revalidatePath("/izin");
    return { ok: true, message: "Talep iptal edildi. Bakiye değişmedi." };
  } catch (error) {
    return finish(error);
  }
}

export async function reviewLeaveAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    const decision = String(formData.get("decision") ?? "");
    const reviewed = await reviewLeaveRequest(actor, String(formData.get("requestId") ?? ""), {
      decision,
      reviewNote: String(formData.get("reviewNote") ?? "").trim() || undefined,
      balanceException: formData.get("balanceException") === "on",
    });
    revalidatePath("/izin");
    revalidatePath("/");
    const employeeNote = reviewed.employeeNotified ? " Çalışana Telegram'dan yazıldı." : " Çalışanın Telegram hesabı bağlı değil.";
    return {
      ok: true,
      message: decision === "APPROVED" ? `Talep onaylandı.${employeeNote}` : `Talep reddedildi. Bakiye değişmedi.${employeeNote}`,
    };
  } catch (error) {
    return finish(error);
  }
}

export async function reverseLeaveAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await reverseLeaveApproval(
      actor,
      String(formData.get("requestId") ?? ""),
      String(formData.get("note") ?? ""),
    );
    revalidatePath("/izin");
    revalidatePath("/");
    return { ok: true, message: "Onay geri alındı ve bakiye düzeltildi." };
  } catch (error) {
    return finish(error);
  }
}

export async function settleLeaveAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    const settlement = String(formData.get("settlement") ?? "");
    if (settlement !== "SALARY" && settlement !== "ANNUAL") {
      return { ok: false, message: "İşaret seçilemedi." };
    }
    const result = await settleLeaveRequest(actor, String(formData.get("requestId") ?? ""), settlement);
    revalidatePath("/izin");
    if (!result.changed) {
      return { ok: true, message: settlement === "SALARY" ? "Bu gün zaten maaştan kesildi." : "Bu gün zaten yıllık izinden düşüldü." };
    }
    return {
      ok: true,
      message: settlement === "SALARY"
        ? "Maaştan kesildi. Bu gün kullanılan izinden düştü."
        : "Yıllık izinden düşüldü. Bu gün kullanılan izinde kalır.",
    };
  } catch (error) {
    return finish(error);
  }
}

export async function balanceAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await setLeaveBalance(actor, {
      userId: formData.get("userId"),
      year: Number(formData.get("year")),
      allocatedDays: String(formData.get("allocatedDays") ?? ""),
      allowBelowUsed: formData.get("allowBelowUsed") === "on",
    });
    revalidatePath("/izin");
    return { ok: true, message: "Yıllık izin bakiyesi kaydedildi." };
  } catch (error) {
    return finish(error);
  }
}

export async function calendarAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await updateLeaveCalendar(actor, {
      hoursPerDay: String(formData.get("hoursPerDay") ?? ""),
      weekendDays: formData.getAll("weekendDays").map((day) => Number(day)),
    });
    revalidatePath("/izin");
    return { ok: true, message: "Çalışma günü ayarları kaydedildi." };
  } catch (error) {
    return finish(error);
  }
}

export async function holidayAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await addLeaveHoliday(actor, {
      date: formData.get("date"),
      name: formData.get("name"),
    });
    revalidatePath("/izin");
    return { ok: true, message: "Tatil eklendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function holidayActiveAction(
  _previous: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireUser();
    const active = formData.get("active") === "true";
    await setLeaveHolidayActive(actor, String(formData.get("holidayId") ?? ""), active);
    revalidatePath("/izin");
    return { ok: true, message: active ? "Tatil yeniden açıldı." : "Tatil hesaptan çıkarıldı." };
  } catch (error) {
    return finish(error);
  }
}
