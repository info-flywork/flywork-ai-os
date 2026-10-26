"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { decideAgentAction, previewInvoiceReader, runGoogleJobNow, setAutomationJobState } from "@/server/services/automation";
import { disconnectGoogleAccount } from "@/server/services/googleLink";
import { createTelegramPairing, revokeTelegramLink } from "@/server/telegram/pairing";

export async function setJobStateAction(formData: FormData): Promise<void> {
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

export async function disconnectGoogleAction(formData: FormData): Promise<void> {
  void formData;
  try {
    const actor = await requireUser();
    await disconnectGoogleAccount(actor);
    revalidatePath("/otomasyon");
  } catch (error) {
    unstable_rethrow(error);
  }
}

export async function runGoogleJobAction(formData: FormData): Promise<void> {
  try {
    const actor = await requireUser();
    const key = String(formData.get("key") ?? "");
    if (key !== "gmail.morning" && key !== "invoice.morning") {
      return;
    }
    await runGoogleJobNow(actor, key);
    revalidatePath("/otomasyon");
  } catch (error) {
    unstable_rethrow(error);
  }
}

export async function previewInvoiceReaderAction(formData: FormData): Promise<void> {
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
  previous: { code?: string; error?: string } | null,
  formData: FormData,
): Promise<{ code?: string; error?: string }> {
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

export async function revokeTelegramLinkAction(formData: FormData): Promise<void> {
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

export async function decideAgentActionAction(formData: FormData): Promise<void> {
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
