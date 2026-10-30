import "server-only";

import { assertCan } from "@/server/auth/permissions";
import { withDatabase } from "@/server/db";
import { invalidate } from "@/server/readCache";
import { AppError } from "@/server/errors";
import { CURRENCIES } from "@/server/finance/catalog";
import { matchesAutoApprove } from "@/server/finance/autoRule";
import { commitReadyReview } from "@/server/finance/commitReview";
import { stringList } from "@/server/jsonList";
import { toIsoDate } from "@/server/dates";

const EMPTY = {
  enabled: false,
  maxAmount: "0.00",
  currency: "TRY",
  vendors: [],
};

function asVendors(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string" && item.trim().length >= 2).map((item) => item.trim());
}

export async function getInvoiceAutoRule() {
  return withDatabase(async (db) => {
    const rule = await db.invoiceAutoRule.findUnique({ where: { id: "default" } });
    if (!rule) {
      return EMPTY;
    }
    return {
      enabled: rule.enabled,
      maxAmount: rule.maxAmount.toString(),
      currency: rule.currency,
      vendors: asVendors(rule.vendors),
    };
  });
}

export async function saveInvoiceAutoRule(actor, input) {
  assertCan(actor, "invoice:write");
  const max = Number(input.maxAmount);
  if (!Number.isFinite(max) || max < 0 || !/^\d+(\.\d{1,2})?$/.test(input.maxAmount)) {
    throw new AppError("Tutar sınırı geçersiz.", "VALIDATION", 400);
  }
  if (!CURRENCIES.includes(input.currency)) {
    throw new AppError("Para birimi geçersiz.", "VALIDATION", 400);
  }
  const vendors = input.vendors;
  if (input.enabled && (vendors.length === 0 || max <= 0)) {
    throw new AppError("Kural açıkken en az bir tedarikçi ve sıfırdan büyük bir tutar gerekir.", "VALIDATION", 400);
  }
  const saved = await withDatabase((db) =>
    db.invoiceAutoRule.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        enabled: input.enabled,
        maxAmount: input.maxAmount,
        currency: input.currency,
        vendors,
      },
      update: {
        enabled: input.enabled,
        maxAmount: input.maxAmount,
        currency: input.currency,
        vendors,
      },
    }),
  );
  let approved = 0;
  if (saved.enabled) {
    approved = await applyInvoiceAutoRule(actor.id);
  }
  invalidate("alerts");
  return { approved };
}

export async function applyInvoiceAutoRule(actorId) {
  return withDatabase(async (db) => {
    const rule = await db.invoiceAutoRule.findUnique({ where: { id: "default" } });
    if (!rule?.enabled) {
      return 0;
    }
    const pending = await db.invoiceReview.findMany({
      where: { status: "PENDING", documentType: { in: ["INVOICE", "RECEIPT"] } },
      take: 50,
    });
    let approved = 0;
    for (const review of pending) {
      const draft = {
        vendor: review.vendor ?? "",
        number: review.number ?? "",
        issuedOn: review.issuedOn ? toIsoDate(review.issuedOn) : "",
        amount: review.amount?.toString() ?? "",
        currency: review.currency ?? "",
        tax: review.tax?.toString() ?? "",
        documentType: review.documentType === "RECEIPT" ? "RECEIPT" : "INVOICE",
      };
      if (!matchesAutoApprove(rule, draft, stringList(review.missingFields), stringList(review.uncertainFields))) {
        continue;
      }
      const result = await commitReadyReview(db, review.id, actorId, "AUTO_APPROVE");
      if (result === "approved" || result === "drive-failed") {
        approved += 1;
      }
    }
    return approved;
  });
}
