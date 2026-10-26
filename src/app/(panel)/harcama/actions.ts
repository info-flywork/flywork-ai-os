"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import {
  createExpense,
  createInvoice,
  importFlyworkInvoiceFile,
  markExpensePaid,
  reviewExpense,
  setExpenseSettlement,
  updateExpense,
} from "@/server/services/finance";
import { runGoogleJobNow } from "@/server/services/automation";

export type FinanceActionState = { ok: boolean; message: string } | null;

async function uploadedFile(formData: FormData) {
  const file = formData.get("belge");
  if (!(file instanceof File) || file.size === 0) {
    return undefined;
  }
  return {
    bytes: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
  };
}

function postedAmount(raw: string): string {
  const trimmed = raw.trim().replace(/\s/g, "");
  if (!trimmed.includes(",")) return trimmed;
  const splitAt = trimmed.lastIndexOf(",");
  const whole = trimmed.slice(0, splitAt).replace(/\./g, "");
  const fraction = trimmed.slice(splitAt + 1);
  return `${whole}.${fraction}`;
}

function refreshFinance() {
  revalidatePath("/");
  revalidatePath("/harcama");
  revalidatePath("/flywork-giderleri");
}

export async function createExpenseAction(
  _state: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  try {
    const actor = await requireUser();
    const result = await createExpense(
      actor,
      {
        scope: String(formData.get("scope") ?? ""),
        category: String(formData.get("category") ?? ""),
        title: String(formData.get("title") ?? ""),
        vendor: String(formData.get("vendor") ?? ""),
        amount: postedAmount(String(formData.get("amount") ?? "")),
        currency: String(formData.get("currency") ?? ""),
        paymentMethod: String(formData.get("paymentMethod") ?? ""),
        accountLabel: String(formData.get("accountLabel") ?? ""),
        spentOn: String(formData.get("spentOn") ?? ""),
        note: String(formData.get("note") ?? ""),
        reimbursement: String(formData.get("reimbursement") ?? "") || undefined,
        userId: String(formData.get("userId") ?? "") || undefined,
        invoiceId: String(formData.get("invoiceId") ?? "") || undefined,
        acceptAmountDifference: formData.get("acceptAmountDifference") === "yes",
      },
      await uploadedFile(formData),
    );
    refreshFinance();
    return { ok: true, message: result.warning ?? "Harcama kaydedildi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function updateExpenseAction(
  _state: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  try {
    const actor = await requireUser();
    const postedInvoice = formData.get("invoiceId");
    await updateExpense(actor, String(formData.get("expenseId") ?? ""), {
      category: String(formData.get("category") ?? ""),
      title: String(formData.get("title") ?? ""),
      vendor: String(formData.get("vendor") ?? ""),
      amount: postedAmount(String(formData.get("amount") ?? "")),
      currency: String(formData.get("currency") ?? ""),
      paymentMethod: String(formData.get("paymentMethod") ?? ""),
      accountLabel: String(formData.get("accountLabel") ?? ""),
      spentOn: String(formData.get("spentOn") ?? ""),
      note: String(formData.get("note") ?? ""),
      reimbursement: String(formData.get("reimbursement") ?? "") || undefined,
      userId: String(formData.get("userId") ?? "") || undefined,
      invoiceId: postedInvoice === null ? undefined : String(postedInvoice) || null,
      acceptAmountDifference: formData.get("acceptAmountDifference") === "yes",
    });
    refreshFinance();
    return { ok: true, message: "Gider güncellendi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function reviewExpenseAction(
  _state: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  try {
    const actor = await requireUser();
    await reviewExpense(actor, String(formData.get("expenseId") ?? ""), {
      decision: String(formData.get("decision") ?? ""),
      reviewNote: String(formData.get("reviewNote") ?? ""),
    });
    refreshFinance();
    return { ok: true, message: "Harcama sonucu kaydedildi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function markPaidAction(
  _state: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  try {
    const actor = await requireUser();
    await markExpensePaid(actor, String(formData.get("expenseId") ?? ""));
    refreshFinance();
    return { ok: true, message: "Ödeme kaydedildi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function setSettlementAction(
  _state: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  try {
    const actor = await requireUser();
    const paid = String(formData.get("paid") ?? "") === "yes";
    await setExpenseSettlement(actor, String(formData.get("expenseId") ?? ""), paid);
    refreshFinance();
    return { ok: true, message: paid ? "Ödendi olarak işaretlendi." : "Ödenmedi olarak işaretlendi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function importFlyworkInvoiceAction(
  _state: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  try {
    const actor = await requireUser();
    const file = await uploadedFile(formData);
    if (!file) {
      return { ok: false, message: "Fatura dosyası seçin." };
    }
    const result = await importFlyworkInvoiceFile(actor, file);
    refreshFinance();
    return { ok: true, message: `${result.vendor} faturası tarandı ve Flywork harcamalarına eklendi.` };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function createInvoiceAction(
  _state: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  try {
    const actor = await requireUser();
    const expenseId = String(formData.get("expenseId") ?? "");
    const result = await createInvoice(
      actor,
      {
        number: String(formData.get("number") ?? ""),
        vendor: String(formData.get("vendor") ?? ""),
        scope: String(formData.get("scope") ?? ""),
        category: String(formData.get("category") ?? ""),
        amount: String(formData.get("amount") ?? ""),
        currency: String(formData.get("currency") ?? ""),
        paymentMethod: String(formData.get("paymentMethod") ?? ""),
        accountLabel: String(formData.get("accountLabel") ?? ""),
        issuedOn: String(formData.get("issuedOn") ?? ""),
        dueOn: String(formData.get("dueOn") ?? "") || undefined,
        note: String(formData.get("note") ?? ""),
        spenderName: String(formData.get("spenderName") ?? "") || undefined,
        expenseId: expenseId || undefined,
        createExpense: false,
      },
      await uploadedFile(formData),
    );
    refreshFinance();
    return { ok: true, message: result.warning ?? "Fatura kaydedildi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function scanGmailAction(
  state: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  void state;
  void formData;
  try {
    const actor = await requireUser();
    const result = await runGoogleJobNow(actor, "invoice.morning");
    refreshFinance();
    revalidatePath("/otomasyon");
    return {
      ok: result.state === "SUCCEEDED",
      message: result.summary,
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}
