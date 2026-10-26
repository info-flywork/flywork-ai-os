"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { deletePaidSubscription, savePaidSubscription } from "@/server/services/paidSubscriptions";
import {
  deleteTechnology,
  recordSubscriptionPayment,
  saveTechnology,
  setTechnologyStatus,
} from "@/server/services/technology";

 

function text(formData, name) {
  const value = String(formData.get(name) ?? "").trim();
  return value || undefined;
}

function refresh() {
  revalidatePath("/");
  revalidatePath("/teknoloji");
  revalidatePath("/flywork-giderleri");
}

function postedAmount(raw) {
  if (!raw) return "0";
  const trimmed = raw.trim().replace(/\s/g, "");
  if (!trimmed) return "0";
  if (!trimmed.includes(",")) return trimmed;
  const splitAt = trimmed.lastIndexOf(",");
  return `${trimmed.slice(0, splitAt).replace(/\./g, "")}.${trimmed.slice(splitAt + 1)}`;
}

function optionalAmount(raw) {
  if (!raw) return undefined;
  const parsed = postedAmount(raw);
  if (!parsed || Number(parsed) <= 0) return undefined;
  return parsed;
}

function technologyInput(formData) {
  const days = text(formData, "customIntervalDays");
  const kind = text(formData, "kind") ?? "SOFTWARE";
  const vendor = text(formData, "vendor") ?? "Belirtilmedi";
  const renewsOn = text(formData, "renewsOn") ?? "";
  const host = text(formData, "host");
  const websiteUrl = host && /^https?:\/\//i.test(host) ? host : text(formData, "websiteUrl");
  const domainName = host && !/^https?:\/\//i.test(host) ? host : text(formData, "domainName");
  return {
    name: text(formData, "name") ?? "",
    vendor,
    kind,
    description: text(formData, "description"),
    project: text(formData, "project"),
    ownerId: text(formData, "ownerId"),
    status: text(formData, "status") ?? "ACTIVE",
    websiteUrl,
    panelUrl: text(formData, "panelUrl"),
    amount: postedAmount(text(formData, "amount")),
    currency: text(formData, "currency") ?? "TRY",
    billingCycle: text(formData, "billingCycle") ?? "YEARLY",
    customIntervalDays: days ? Number(days) : undefined,
    renewsOn,
    lastPaidOn: text(formData, "lastPaidOn"),
    paymentMethod: text(formData, "paymentMethod") ?? "OTHER",
    cardLast4: text(formData, "cardLast4"),
    autoRenew: formData.get("autoRenew") === "yes",
    domainName,
    registrar: text(formData, "registrar"),
    domainExpiresOn: text(formData, "domainExpiresOn") ?? (kind === "DOMAIN" ? renewsOn : undefined),
    dnsProvider: text(formData, "dnsProvider") ?? (kind === "HOSTING" ? vendor : undefined),
    sslIssuer: text(formData, "sslIssuer"),
    sslExpiresOn: text(formData, "sslExpiresOn"),
    note: text(formData, "note"),
  };
}

export async function deleteTechnologyAction(
  state,
  formData,
) {
  void state;
  try {
    const actor = await requireUser();
    await deleteTechnology(actor, text(formData, "subscriptionId") ?? "");
    refresh();
    return { ok: true, message: "Hizmet silindi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function deletePaidSubscriptionAction(
  state,
  formData,
) {
  void state;
  try {
    const actor = await requireUser();
    await deletePaidSubscription(actor, text(formData, "id") ?? "");
    refresh();
    return { ok: true, message: "Abonelik silindi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function saveTechnologyAction(
  state,
  formData,
) {
  void state;
  try {
    const actor = await requireUser();
    const id = text(formData, "id") ?? null;
    if (text(formData, "recordKind") === "payment") {
      const amount = optionalAmount(text(formData, "amount"));
      await savePaidSubscription(actor, {
        ...(id ? { id } : {}),
        name: text(formData, "name") ?? "",
        cycle: text(formData, "cycle") ?? "",
        ...(amount ? { amount, currency: text(formData, "currency") ?? "TRY" } : {}),
        ...(text(formData, "startedOn") ? { startedOn: text(formData, "startedOn") } : {}),
        ...(text(formData, "lastPaidOn") ? { lastPaidOn: text(formData, "lastPaidOn") } : {}),
      });
      refresh();
      return { ok: true, message: id ? "Abonelik güncellendi." : "Abonelik eklendi." };
    }
    await saveTechnology(actor, id, technologyInput(formData));
    refresh();
    return { ok: true, message: id ? "Hizmet güncellendi." : "Hizmet kaydedildi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function setTechnologyStatusAction(
  state,
  formData,
) {
  void state;
  try {
    const actor = await requireUser();
    await setTechnologyStatus(actor, {
      subscriptionId: text(formData, "subscriptionId") ?? "",
      status: text(formData, "status") ?? "",
    });
    refresh();
    return { ok: true, message: "Hizmet durumu güncellendi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}

export async function recordPaymentAction(
  state,
  formData,
) {
  void state;
  try {
    const actor = await requireUser();
    const expenseId = text(formData, "expenseId");
    await recordSubscriptionPayment(actor, {
      subscriptionId: text(formData, "subscriptionId") ?? "",
      periodEnd: text(formData, "periodEnd") ?? "",
      paidOn: text(formData, "paidOn") ?? "",
      amount: text(formData, "amount") ?? "",
      currency: text(formData, "currency") ?? "",
      note: text(formData, "note"),
      createExpense: formData.get("createExpense") === "yes" && !expenseId,
      expenseId,
    });
    refresh();
    return { ok: true, message: "Ödeme kaydedildi. Sonraki yenileme tarihi güncellendi." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: toPublicError(error).message };
  }
}
