import "server-only";

import { assertCan } from "@/server/auth/permissions";
import { formatIstanbul } from "@/server/automation/schedule";
import { vendorKey } from "@/server/finance/catalog";
import { stringList } from "@/server/jsonList";
import { dateOnly, toIsoDate } from "@/server/dates";
import { parseMoney } from "@/server/finance/money";
import { readFinanceFile } from "@/server/finance/documents";
import { ensureInvoiceExpense } from "@/server/finance/commitReview";
import { planDriveArchive } from "@/server/finance/google";
import {
  approvalRoute,
  emptyDraft,
  fieldCorrections,
  reviewIssues,
  REVIEW_FIELDS,
  validAmount,
  validCurrency,
  validDate,
  validTax,



} from "@/server/finance/reviewRules";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import { accessTokenFor } from "@/server/google/account";
import { createDriveApi, ensureDriveFolder } from "@/server/google/drive";

 










function moneyText(value) {
  if (!value) {
    return "";
  }
  const parsed = parseMoney(value.toString());
  return parsed.state === "certain" && parsed.value ? parsed.value : value.toString();
}

function draftFromRow(row







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

function snapshotDraft(value) {
  const draft = emptyDraft();
  if (!value || typeof value !== "object") {
    return draft;
  }
  const row = value ;
  for (const key of REVIEW_FIELDS) {
    if (typeof row[key] === "string") {
      draft[key] = row[key];
    }
  }
  return draft;
}

function reviewData(draft) {
  const issues = reviewIssues(draft);
  const missing = REVIEW_FIELDS.filter((key) => {
    if (key === "tax") {
      return false;
    }
    if (key === "vendor") {
      return draft.vendor.trim().length < 2;
    }
    if (key === "documentType") {
      return draft.documentType !== "INVOICE" && draft.documentType !== "RECEIPT";
    }
    return !draft[key].trim();
  });
  const documentType =
    draft.documentType === "INVOICE" || draft.documentType === "RECEIPT" || draft.documentType === "NOT_INVOICE"
      ? draft.documentType
      : "UNKNOWN";
  return {
    issues,
    data: {
      vendor: draft.vendor.trim() || null,
      number: draft.number.trim() || null,
      issuedOn: validDate(draft.issuedOn) ? dateOnly(draft.issuedOn) : null,
      amount: validAmount(draft.amount) ? draft.amount : null,
      currency: validCurrency(draft.currency) ? draft.currency : null,
      tax: draft.tax && validTax(draft.tax) ? draft.tax : null,
      documentType,
      missingFields: missing,
      uncertainFields: [] ,
    },
  };
}

function safeDriveError(error) {
  const message = error instanceof Error ? error.message : "Drive yüklemesi başarısız.";
  if (/sk-|bearer|refresh|token|secret|client_secret/i.test(message)) {
    return "Drive yüklemesi başarısız.";
  }
  return message.slice(0, 180);
}

async function liveUpload(
  db,
  input,
) {
  const access = await accessTokenFor(db);
  if (!access) {
    throw new Error("Google Drive bağlı değil.");
  }
  const drive = createDriveApi(access.token);
  const parentId = await ensureDriveFolder(db, drive, input.folder);
  const existing = await drive.findChildFile(input.fileName, parentId);
  if (existing) {
    return existing;
  }
  return drive.uploadPdf(input.fileName, parentId, input.bytes);
}

export async function listInvoiceReviews(actor) {
  assertCan(actor, "invoice:read");
  return withDatabase(async (db) => {
    const rows = await db.invoiceReview.findMany({
      where: { documentType: { not: "STATEMENT" } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      status: row.status ,
      fileName: row.fileName,
      vendor: row.vendor,
      number: row.number,
      documentType: row.documentType,
      missingFields: stringList(row.missingFields),
      uncertainFields: stringList(row.uncertainFields),
      archived: row.archived,
      driveError: row.driveError,
      createdAt: formatIstanbul(row.createdAt),
    }));
  });
}

export async function getInvoiceReview(actor, id) {
  assertCan(actor, "invoice:read");
  return withDatabase(async (db) => {
    const row = await db.invoiceReview.findUnique({
      where: { id },
      include: {
        audits: {
          orderBy: { createdAt: "desc" },
          include: { actor: { select: { name: true } } },
        },
      },
    });
    if (!row) {
      throw new AppError("İnceleme bulunamadı.", "NOT_FOUND", 404);
    }
    return {
      id: row.id,
      status: row.status ,
      fileName: row.fileName,
      draft: draftFromRow(row),
      kind: row.documentType,
      missingFields: stringList(row.missingFields) ,
      uncertainFields: stringList(row.uncertainFields) ,
      archived: row.archived,
      driveError: row.driveError,
      invoiceId: row.invoiceId,
      createdAt: formatIstanbul(row.createdAt),
      audits: row.audits.map((audit) => ({
        id: audit.id,
        action: audit.action,
        actor: audit.actor.name,
        createdAt: formatIstanbul(audit.createdAt),
        corrections: audit.corrections,
      })),
    };
  });
}

export async function openReviewPdf(actor, id) {
  assertCan(actor, "invoice:read");
  return withDatabase(async (db) => {
    const row = await db.invoiceReview.findUnique({
      where: { id },
      select: { storageKey: true, fileName: true },
    });
    if (!row) {
      throw new AppError("Belge bulunamadı.", "NOT_FOUND", 404);
    }
    return {
      bytes: await readFinanceFile(row.storageKey),
      fileName: row.fileName,
      contentType: "application/pdf",
    };
  });
}

export async function decideInvoiceReview(
  actor,
  id,
  decision,
  draft,
  upload,
) {
  assertCan(actor, "invoice:write");
  return withDatabase(async (db) => {
    const review = await db.invoiceReview.findUnique({ where: { id } });
    if (!review) {
      throw new AppError("İnceleme bulunamadı.", "NOT_FOUND", 404);
    }
    if (review.documentType === "STATEMENT") {
      throw new AppError("Ekstre fatura kuyruğundan ayrı tutulur. Onay, gider ve Drive işlemi yapılmadı.", "VALIDATION", 400);
    }
    if (decision === "hold" || decision === "reject") {
      if (review.status === "APPROVED" || review.status === "DRIVE_FAILED") {
        throw new AppError(
          "Kayıt oluştuğu için belge reddedilemez veya bekletilemez. Drive yüklemesi yeniden denenebilir.",
          "VALIDATION",
          400,
        );
      }
      const saved = reviewData(draft);
      await db.invoiceReview.update({
        where: { id },
        data: { ...saved.data, status: decision === "hold" ? "HELD" : "REJECTED" },
      });
      await db.invoiceReviewAudit.create({
        data: {
          reviewId: id,
          actorId: actor.id,
          action: decision === "hold" ? "HOLD" : "REJECT",
          corrections: fieldCorrections(snapshotDraft(review.aiSnapshot), draft),
        },
      });
      return { outcome: decision === "hold" ? "held" : "rejected", invoiceId: null };
    }

    if (review.status === "REJECTED") {
      throw new AppError("Reddedilen belge onaylanamaz.", "VALIDATION", 400);
    }
    if (review.driveFileId) {
      return { outcome: "already", invoiceId: review.invoiceId };
    }
    const saved = reviewData(draft);
    await db.invoiceReview.update({ where: { id }, data: saved.data });
    if (saved.issues.length > 0) {
      throw new AppError(`Onay için eksik veya geçersiz: ${saved.issues.join(", ")}.`, "VALIDATION", 400);
    }
    const key = vendorKey(draft.vendor);
    const vendorHit = await db.invoice.findUnique({
      where: { vendorKey_number: { vendorKey: key, number: draft.number.trim() } },
      select: { id: true },
    });
    const hashHit = await db.invoiceDocument.findFirst({
      where: { contentHash: review.contentHash },
      select: { invoiceId: true },
    });
    const route = approvalRoute({
      status: review.status ,
      driveFileId: review.driveFileId,
      invoiceId: review.invoiceId,
      otherHashInvoiceId: hashHit?.invoiceId ?? null,
      otherVendorInvoiceId: vendorHit?.id ?? null,
    });
    if (route === "already") {
      return { outcome: "already", invoiceId: review.invoiceId };
    }

    let invoiceId = review.invoiceId;
    if (route === "create") {
      const created = await db.$transaction(async (tx) => {
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
          where: { id },
          data: { invoiceId: invoice.id },
        });
        await ensureInvoiceExpense(tx, invoice.id, actor.id, draft);
        return invoice.id;
      });
      invoiceId = created;
    } else if (invoiceId) {
      await db.invoice.update({
        where: { id: invoiceId },
        data: {
          number: draft.number.trim(),
          vendor: draft.vendor.trim(),
          vendorKey: key,
          amount: draft.amount,
          currency: draft.currency,
          tax: draft.tax || null,
          issuedOn: dateOnly(draft.issuedOn),
          note: draft.documentType === "RECEIPT" ? "Fiş" : null,
        },
      });
      await ensureInvoiceExpense(db, invoiceId, actor.id, draft);
    }

    const archive = planDriveArchive({
      issuedOn: draft.issuedOn,
      vendor: draft.vendor,
      number: draft.number,
    });
    const corrections = fieldCorrections(snapshotDraft(review.aiSnapshot), draft);
    try {
      const bytes = await readFinanceFile(review.storageKey);
      const driveFileId = upload
        ? await upload({ folder: archive.folder, fileName: archive.fileName, bytes })
        : await liveUpload(db, { folder: archive.folder, fileName: archive.fileName, bytes });
      await db.invoiceReview.update({
        where: { id },
        data: { status: "APPROVED", archived: true, driveFileId, driveError: null },
      });
      await db.invoiceReviewAudit.create({
        data: {
          reviewId: id,
          actorId: actor.id,
          action: route === "retry" ? "RETRY_DRIVE" : "APPROVE",
          corrections,
        },
      });
      return { outcome: "approved", invoiceId };
    } catch (error) {
      await db.invoiceReview.update({
        where: { id },
        data: { status: "DRIVE_FAILED", archived: false, driveError: safeDriveError(error) },
      });
      await db.invoiceReviewAudit.create({
        data: {
          reviewId: id,
          actorId: actor.id,
          action: "DRIVE_FAILED",
          corrections,
        },
      });
      return { outcome: "drive-failed", invoiceId };
    }
  });
}
