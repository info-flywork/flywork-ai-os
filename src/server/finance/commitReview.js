import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { dateOnly, toIsoDate } from "@/server/dates";
import { presetCardCharge } from "@/server/finance/cards";
import { vendorKey } from "@/server/finance/catalog";
import { isOwnCompanyName } from "@/server/finance/ownCompany";
import { planDriveArchive } from "@/server/finance/google";
import {
  canAutoApprove,
  emptyDraft,
  reviewIssues,
  validAmount,

} from "@/server/finance/reviewRules";
import { accessTokenFor } from "@/server/google/account";
import { stringList } from "@/server/jsonList";
import { createDriveApi, ensureDriveFolder } from "@/server/google/drive";





export async function ensureInvoiceExpense(
  db,
  invoiceId,
  actorId,
  draft,
) {
  const existing = await db.expense.findUnique({ where: { invoiceId }, select: { id: true } });
  if (existing) {
    return;
  }
  const vendor = draft.vendor.trim();
  const charge = presetCardCharge(vendor);
  await db.expense.create({
    data: {
      userId: actorId,
      scope: "COMPANY",
      category: "OTHER",
      title: (vendor || "Fatura").slice(0, 160),
      vendor: vendor || null,
      amount: draft.amount,
      currency: draft.currency,
      paymentMethod: charge.paymentMethod,
      accountLabel: charge.accountLabel,
      spentOn: dateOnly(draft.issuedOn),
      status: "APPROVED",
      reimbursement: "NOT_REQUIRED",
      source: "UPLOAD",
      note: `Fatura ${draft.number.trim()}`.slice(0, 500),
      invoiceId,
      reviewerId: actorId,
      reviewedAt: new Date(),
    },
  });
}

function moneyText(value) {
  if (!value) {
    return "";
  }
  const raw = value.toString();
  if (validAmount(raw)) {
    return raw;
  }
  const number = Number(raw);
  if (!Number.isFinite(number) || number <= 0) {
    return "";
  }
  return number.toFixed(2);
}

function draftFromReview(row







) {
  const draft = emptyDraft();
  draft.vendor = row.vendor ?? "";
  draft.number = row.number ?? "";
  draft.issuedOn = row.issuedOn ? toIsoDate(row.issuedOn) : "";
  draft.amount = moneyText(row.amount);
  draft.currency = row.currency ?? "";
  draft.tax = moneyText(row.tax);
  draft.documentType = row.documentType === "INVOICE" || row.documentType === "RECEIPT" ? row.documentType : "";
  return draft;
}

async function uploadPdf(db, folder, fileName, bytes) {
  const access = await accessTokenFor(db);
  if (!access) {
    throw new Error("Google Drive bağlı değil.");
  }
  const drive = createDriveApi(access.token);
  const parentId = await ensureDriveFolder(db, drive, folder);
  const existing = await drive.findChildFile(fileName, parentId);
  if (existing) {
    return existing;
  }
  return drive.uploadPdf(fileName, parentId, bytes);
}

export async function commitReadyReview(db, reviewId, actorId, auditAction = "APPROVE") {
  const review = await db.invoiceReview.findUnique({ where: { id: reviewId } });
  if (!review || review.documentType === "STATEMENT" || review.status === "REJECTED" || isOwnCompanyName(review.vendor)) {
    return "skipped";
  }
  if (review.status === "APPROVED" || review.driveFileId) {
    return "skipped";
  }
  const draft = draftFromReview(review);
  if (!canAutoApprove(draft, stringList(review.missingFields), stringList(review.uncertainFields)) || reviewIssues(draft).length > 0) {
    return "needs-approval";
  }

  const key = vendorKey(draft.vendor);
  let invoiceId = review.invoiceId;
  if (!invoiceId) {
    try {
      invoiceId = await db.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            number: draft.number.trim(),
            vendor: draft.vendor.trim(),
            vendorKey: key,
            scope: "COMPANY",
            amount: draft.amount,
            currency: draft.currency,
            tax: draft.tax || null,
            issuedOn: dateOnly(draft.issuedOn),
            source: "UPLOAD",
            status: "ISSUED",
            note: draft.documentType === "RECEIPT" ? "Fiş" : null,
            ...presetCardCharge(draft.vendor),
          },
        });
        await tx.invoiceDocument.create({
          data: {
            invoiceId: invoice.id,
            storageKey: review.storageKey,
            fileName: review.fileName,
            contentType: "application/pdf",
            sizeBytes: review.sizeBytes,
            contentHash: review.contentHash,
          },
        });
        await tx.invoiceReview.update({
          where: { id: review.id },
          data: { invoiceId: invoice.id },
        });
        await ensureInvoiceExpense(tx, invoice.id, actorId, draft);
        return invoice.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return "skipped";
      }
      throw error;
    }
  }

  if (invoiceId) {
    await ensureInvoiceExpense(db, invoiceId, actorId, draft);
  }

  const archive = planDriveArchive({
    issuedOn: draft.issuedOn,
    vendor: draft.vendor,
    number: draft.number,
  });
  try {
    const bytes = await readFile(path.resolve(process.cwd(), "storage", "finance-documents", review.storageKey));
    const driveFileId = await uploadPdf(db, archive.folder, archive.fileName, bytes);
    await db.invoiceReview.update({
      where: { id: review.id },
      data: { status: "APPROVED", archived: true, driveFileId, driveError: null },
    });
    await db.invoiceReviewAudit.create({
      data: { reviewId: review.id, actorId, action: auditAction, corrections: {} },
    });
    return "approved";
  } catch {
    await db.invoiceReview.update({
      where: { id: review.id },
      data: { status: "DRIVE_FAILED", archived: false, driveError: "Drive yüklemesi başarısız." },
    });
    await db.invoiceReviewAudit.create({
      data: { reviewId: review.id, actorId, action: "DRIVE_FAILED", corrections: {} },
    });
    return "drive-failed";
  }
}
