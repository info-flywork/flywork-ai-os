"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import {
  createExpense,
  createInvoice,
  attachInvoiceFile,
  deleteInvoiceLine,
  importFlyworkInvoiceFile,
  markExpensePaid,
  reviewExpense,
  setExpenseSettlement,
  updateExpense,
  updateInvoiceLine,
} from "@/server/services/finance";
import { runGoogleJobNow } from "@/server/services/automation";

 

async function uploadedFile(formData) {
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

function postedAmount(raw) {
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
  _state,
  formData,
) {
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
  _state,
  formData,
) {
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
  _state,
  formData,
) {
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
  _state,
  formData,
) {
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
  _state,
  formData,
) {
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
  _state,
  formData,
) {
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
  _state,
  formData,
) {
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

export async function updateInvoiceLineAction(_state, formData) {
  try {
    const actor = await requireUser();
    const invoiceId = String(formData.get("invoiceId") ?? "");
    const expenseId = String(formData.get("expenseId") ?? "");
    await updateInvoiceLine(actor, {
      invoiceId: invoiceId || undefined,
      expenseId: expenseId || undefined,
      vendor: String(formData.get("vendor") ?? ""),
      description: String(formData.get("description") ?? ""),
      quantity: String(formData.get("quantity") ?? ""),
      amount: postedAmount(String(formData.get("amount") ?? "")),
      currency: String(formData.get("currency") ?? ""),
      paymentMethod: String(formData.get("paymentMethod") ?? ""),
      accountLabel: String(formData.get("accountLabel") ?? ""),
      issuedOn: String(formData.get("issuedOn") ?? ""),
      person: String(formData.get("person") ?? ""),
    });
    refreshFinance();
    return { ok: true, message: "Satır güncellendi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function attachInvoiceFileAction(_state, formData) {
  try {
    const actor = await requireUser();
    const file = await uploadedFile(formData);
    if (!file) {
      return { ok: false, message: "Fatura dosyası seçin." };
    }
    await attachInvoiceFile(
      actor,
      String(formData.get("invoiceId") ?? ""),
      String(formData.get("expenseId") ?? ""),
      file,
    );
    refreshFinance();
    return { ok: true, message: "Fatura eklendi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function deleteInvoiceLineAction(_state, formData) {
  try {
    const actor = await requireUser();
    await deleteInvoiceLine(
      actor,
      String(formData.get("invoiceId") ?? ""),
      String(formData.get("expenseId") ?? ""),
    );
    refreshFinance();
    return { ok: true, message: "Harcama silindi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function scanGmailAction(
  state,
  formData,
) {
  void state;
  void formData;
  try {
    const actor = await requireUser();
    const result = await runGoogleJobNow(actor, "invoice.daily");
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
