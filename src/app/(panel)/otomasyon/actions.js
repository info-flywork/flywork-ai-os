"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { decideAgentAction, previewInvoiceReader, runGoogleJobNow, setAutomationJobState, setInvoiceScanSchedule } from "@/server/services/automation";
import { disconnectGoogleAccount } from "@/server/services/googleLink";
import { createTelegramPairing, revokeTelegramLink } from "@/server/telegram/pairing";

export async function setJobStateAction(formData) {
  try {
    const actor = await requireUser();
    const next = String(formData.get("state") ?? "");
    if (next !== "ACTIVE" && next !== "PAUSED") {
      return;
    }
    await setAutomationJobState(actor, String(formData.get("jobId") ?? ""), next);
    revalidatePath("/otomasyon");
  } catch (error) {
    unstable_rethrow(error);
  }
}

export async function disconnectGoogleAction(formData) {
  void formData;
  try {
    const actor = await requireUser();
    await disconnectGoogleAccount(actor);
    revalidatePath("/otomasyon");
  } catch (error) {
    unstable_rethrow(error);
  }
}

export async function setJobScheduleAction(formData) {
  try {
    const actor = await requireUser();
    const clock = String(formData.get("clock") ?? "");
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
    if (!match) {
      redirect("/otomasyon?saat=hata");
    }
    const saved = await setInvoiceScanSchedule(
      actor,
      String(formData.get("jobId") ?? ""),
      Number(match[1]),
      Number(match[2]),
    );
    revalidatePath("/otomasyon");
    if (!saved.ok) {
      redirect("/otomasyon?saat=kilit");
    }
  } catch (error) {
    unstable_rethrow(error);
  }
}

export async function runGoogleJobAction(formData) {
  try {
    const actor = await requireUser();
    const key = String(formData.get("key") ?? "");
    if (key !== "invoice.daily") {
      return;
    }
    const result = await runGoogleJobNow(actor, key);
    revalidatePath("/otomasyon");
    if (result.summary.includes("zaten çalışıyor")) {
      redirect("/otomasyon?tarama=calisiyor");
    }
    if (result.summary.includes("son 5 dakika")) {
      redirect("/otomasyon?tarama=beklet");
    }
  } catch (error) {
    unstable_rethrow(error);
  }
}

export async function previewInvoiceReaderAction(formData) {
  void formData;
  try {
    const actor = await requireUser();
    await previewInvoiceReader(actor);
    revalidatePath("/otomasyon");
  } catch (error) {
    unstable_rethrow(error);
  }
}

export async function createTelegramPairingAction(
  previous,
  formData,
) {
  void previous;
  void formData;
  try {
    const actor = await requireUser();
    const created = await createTelegramPairing(actor);
    revalidatePath("/yemek-yonetimi");
    revalidatePath("/otomasyon");
    return { code: created.code };
  } catch (error) {
    unstable_rethrow(error);
    return { error: toPublicError(error).message };
  }
}

export async function revokeTelegramLinkAction(formData) {
  void formData;
  try {
    const actor = await requireUser();
    await revokeTelegramLink(actor);
    revalidatePath("/otomasyon");
    revalidatePath("/yemek-yonetimi");
  } catch (error) {
    unstable_rethrow(error);
  }
}

export async function decideAgentActionAction(formData) {
  try {
    const actor = await requireUser();
    const decision = String(formData.get("decision") ?? "");
    if (decision !== "APPROVED" && decision !== "REJECTED") {
      return;
    }
    await decideAgentAction(actor, String(formData.get("actionId") ?? ""), decision);
    revalidatePath("/otomasyon");
  } catch (error) {
    unstable_rethrow(error);
  }
}
