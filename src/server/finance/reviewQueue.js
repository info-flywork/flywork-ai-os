import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { documentHash } from "@/server/finance/pdfText";
import {
  emptyDraft,
  REVIEW_FIELDS,
  validAmount,
  validCurrency,
  validDate,
  validTax,


} from "@/server/finance/reviewRules";



const KINDS = new Set(["INVOICE", "RECEIPT", "NOT_INVOICE", "UNKNOWN", "STATEMENT"]);

function preserveEditedFields(
  input



,
  existing








,
) {
  const protectedFields = new Set();
  for (const audit of existing.audits) {
    if (!audit.corrections || typeof audit.corrections !== "object") {
      continue;
    }
    for (const key of Object.keys(audit.corrections)) {
      if ((REVIEW_FIELDS ).includes(key)) {
        protectedFields.add(key );
      }
    }
  }
  const current = emptyDraft();
  current.vendor = existing.vendor ?? "";
  current.number = existing.number ?? "";
  current.issuedOn = existing.issuedOn ? existing.issuedOn.toISOString().slice(0, 10) : "";
  current.amount = existing.amount ? existing.amount.toString() : "";
  current.currency = existing.currency ?? "";
  current.tax = existing.tax ? existing.tax.toString() : "";
  current.documentType = existing.documentType === "INVOICE" || existing.documentType === "RECEIPT" || existing.documentType === "NOT_INVOICE" || existing.documentType === "STATEMENT"
    ? existing.documentType
    : "";
  const draft = { ...input.draft };
  for (const key of protectedFields) {
    draft[key] = current[key];
  }
  return {
    draft,
    missing: input.missing.filter((field) => !protectedFields.has(field)),
    uncertain: input.uncertain.filter((field) => !protectedFields.has(field)),
  };
}

async function writeReviewFile(storageKey, bytes) {
  const directory = path.resolve(process.cwd(), "storage", "finance-documents");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, storageKey), bytes, { flag: "wx" });
}

async function removeReviewFile(storageKey) {
  await rm(path.resolve(process.cwd(), "storage", "finance-documents", storageKey), { force: true });
}

export function storedReview(draft, missing, uncertain) {
  const snapshot = emptyDraft();
  const uncertainSet = new Set(uncertain);
  const missingSet = new Set(missing);
  for (const key of Object.keys(snapshot) ) {
    if (uncertainSet.has(key)) {
      continue;
    }
    snapshot[key] = draft[key].trim();
  }
  if (validDate(snapshot.issuedOn)) {
    missingSet.delete("issuedOn");
    uncertainSet.delete("issuedOn");
  } else {
    snapshot.issuedOn = "";
    missingSet.add("issuedOn");
  }
  if (!validAmount(snapshot.amount)) {
    snapshot.amount = "";
    missingSet.add("amount");
  }
  snapshot.currency = snapshot.currency.toUpperCase();
  if (!validCurrency(snapshot.currency)) {
    snapshot.currency = "";
    missingSet.add("currency");
  }
  if (!validTax(snapshot.tax)) {
    snapshot.tax = "";
    missingSet.add("tax");
  }
  if (snapshot.vendor.trim().length < 2) {
    snapshot.vendor = "";
    missingSet.add("vendor");
  }
  if (!snapshot.number.trim()) {
    missingSet.add("number");
  }
  if (snapshot.documentType === "STATEMENT") {
    missingSet.delete("documentType");
  } else if (snapshot.documentType !== "INVOICE" && snapshot.documentType !== "RECEIPT" && snapshot.documentType !== "NOT_INVOICE") {
    snapshot.documentType = "";
    missingSet.add("documentType");
  }
  for (const key of uncertainSet) {
    missingSet.delete(key);
  }
  const documentType = KINDS.has(snapshot.documentType) ? snapshot.documentType : "UNKNOWN";
  return {
    snapshot,
    data: {
      vendor: snapshot.vendor || null,
      number: snapshot.number || null,
      issuedOn: snapshot.issuedOn ? new Date(`${snapshot.issuedOn}T00:00:00.000Z`) : null,
      amount: snapshot.amount || null,
      currency: snapshot.currency || null,
      tax: snapshot.tax || null,
      documentType: documentType ,
      missingFields: [...missingSet],
      uncertainFields: [...uncertainSet],
      aiSnapshot: snapshot,
    },
  };
}

export async function queuePendingReview(
  db,
  input





,
) {
  const contentHash = documentHash(input.bytes);
  const existing = await db.invoiceReview.findUnique({
    where: { contentHash },
    include: { audits: { select: { corrections: true } } },
  });
  const editable = existing ? preserveEditedFields(input, existing) : input;
  const stored = storedReview(editable.draft, editable.missing, editable.uncertain);
  if (existing) {
    if (existing.status !== "PENDING" && existing.status !== "HELD") {
      return "kept";
    }
    await db.invoiceReview.update({
      where: { id: existing.id },
      data: stored.data,
    });
    return "kept";
  }
  const storageKey = randomBytes(16).toString("hex");
  const safeName = path.basename(input.fileName).replace(/[^\w.\- ]+/g, "").slice(0, 120) || "belge.pdf";
  await writeReviewFile(storageKey, input.bytes);
  try {
    await db.invoiceReview.create({
      data: {
        contentHash,
        storageKey,
        fileName: safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`,
        sizeBytes: input.bytes.length,
        ...stored.data,
      },
    });
  } catch (error) {
    await removeReviewFile(storageKey);
    throw error;
  }
  return "queued";
}
