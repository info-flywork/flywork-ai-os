
import { vendorKey } from "@/server/finance/catalog";
import { aiDocumentEnv } from "@/server/finance/documentAi";
import { documentHash } from "@/server/finance/pdfText";
import {
  analyzeFinanceDocument,
  readFinanceDocument,

} from "@/server/finance/readDocument";
import { commitReadyReview } from "@/server/finance/commitReview";
import { queuePendingReview } from "@/server/finance/reviewQueue";
import { canAutoApprove, emptyDraft, reviewIssues, REVIEW_LABELS } from "@/server/finance/reviewRules";
import { formatIstanbul } from "@/server/automation/schedule";
import { stringList } from "@/server/jsonList";
import { GMAIL_QUERIES, listMessageIds } from "@/server/google/gmail";



const INVOICE_LIMIT = 20;
const MAX_BYTES = 8 * 1024 * 1024;

 



















export class InvoiceScanRetryError extends Error {
   report;

  constructor(message, report) {
    super(message);
    this.name = "InvoiceScanRetryError";
    this.report = report;
  }
}

function gmailTransportError(error) {
  return error instanceof Error && (
    error.message === "Gmail yanıt vermedi." ||
    /^Gmail isteği başarısız \(\d+\)$/.test(error.message)
  );
}

function isUniqueViolation(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function importGmailInvoices(
  db,
  gmail,
  options = {},
) {
  const report = {
    connected: true,
    aiConfigured: aiDocumentEnv().configured,
    scannedAt: formatIstanbul(options.now ?? new Date()),
    found: 0,
    queued: 0,
    processed: [],
    needsApproval: [],
    imported: [],
    duplicates: [],
    rejected: [],
    errors: [],
    retryable: 0,
    statements: 0,
    driveUploaded: false,
    archivePattern: "Flywork/Faturalar/{yil}/{ay}/{tedarikci}-{fatura-no}.pdf",
  };
  const analyze = options.analyze ?? ((bytes, fileName) =>
    analyzeFinanceDocument(bytes, fileName, { useVision: true, fetchImpl: options.fetchImpl }));
  const messageIds = await listMessageIds(gmail, GMAIL_QUERIES.invoices, INVOICE_LIMIT);
  for (const messageId of messageIds) {
    try {
      const message = await gmail.listPdfAttachments(messageId);
      if (message.attachments.length === 0) {
        await rememberAbsence(db, report, messageId, message.threadId);
        continue;
      }
      for (const attachment of message.attachments) {
        const attachmentId = attachment.attachmentId ?? `inline:${attachment.filename}`;
        report.found += 1;
        if (await alreadySeen(db, messageId, attachmentId)) {
          report.duplicates.push({ messageId, number: "", vendor: "" });
          continue;
        }
        const bytes = attachment.data ?? (attachment.attachmentId
          ? await gmail.getAttachment(messageId, attachment.attachmentId)
          : Buffer.alloc(0));
        await importOne(db, analyze, report, options.commitActorId, {
          messageId,
          threadId: message.threadId,
          attachmentId,
          fileName: attachment.filename,
          bytes,
        });
      }
    } catch (error) {
      if (!gmailTransportError(error)) {
        throw error;
      }
      report.retryable += 1;
      report.errors.push("Gmail yanıt vermedi. Bu ileti yeniden denenecek.");
    }
  }
  if (report.retryable > 0) {
    const gmailOnly = report.errors.length > 0 && report.errors.every((item) => item.startsWith("Gmail yanıt vermedi."));
    throw new InvoiceScanRetryError(
      gmailOnly ? "Gmail yanıt vermedi. Posta değiştirilmedi. Yeniden denenecek." : invoiceSummary(report),
      report,
    );
  }
  return report;
}

async function alreadySeen(db, messageId, attachmentId) {
  const seen = await db.gmailProcessedItem.findUnique({
    where: {
      gmailMessageId_attachmentId_purpose: {
        gmailMessageId: messageId,
        attachmentId,
        purpose: "INVOICE",
      },
    },
    select: { id: true },
  });
  return Boolean(seen);
}

async function rememberAbsence(db, report, messageId, threadId) {
  if (await alreadySeen(db, messageId, "")) {
    return;
  }
  await remember(db, {
    gmailMessageId: messageId,
    attachmentId: "",
    threadId,
    outcome: "NO_PDF",
  });
  report.rejected.push({
    messageId,
    fileName: "",
    reason: "PDF eki yok. Yazışma fatura olarak kaydedilmedi.",
  });
}

async function remember(
  db,
  row





,
) {
  try {
    await db.gmailProcessedItem.create({
      data: {
        gmailMessageId: row.gmailMessageId,
        attachmentId: row.attachmentId,
        purpose: "INVOICE",
        threadId: row.threadId || null,
        outcome: row.outcome,
        invoiceId: row.invoiceId ?? null,
        driveFileId: null,
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }
}

async function importOne(
  db,
  analyze,
  report,
  commitActorId,
  input





,
) {
  const reject = async (reason) => {
    await remember(db, {
      gmailMessageId: input.messageId,
      attachmentId: input.attachmentId,
      threadId: input.threadId,
      outcome: "REJECTED",
    });
    report.rejected.push({ messageId: input.messageId, fileName: input.fileName, reason });
  };
  const duplicate = async (number = "", vendor = "", invoiceId) => {
    await remember(db, {
      gmailMessageId: input.messageId,
      attachmentId: input.attachmentId,
      threadId: input.threadId,
      outcome: "DUPLICATE",
      invoiceId: storedInvoiceId(invoiceId),
    });
    report.duplicates.push({ messageId: input.messageId, number, vendor });
  };
  if (input.bytes.length === 0 || input.bytes.length > MAX_BYTES || input.bytes.subarray(0, 4).toString("utf8") !== "%PDF") {
    await reject("PDF değil veya boyut sınırı dışında. Kuyruğa alınmadı.");
    return;
  }
  const hash = documentHash(input.bytes);
  const known = await knownDocument(db, hash);
  if (known) {
    await duplicate("", "", known);
    return;
  }
  const preview = readFinanceDocument(input.bytes, input.fileName);
  if (preview.kind === "STATEMENT") {
    await keepStatement(db, report, input, preview);
    return;
  }
  if (preview.kind === "NOT_INVOICE" || (preview.textLayer === "READABLE" && preview.kind !== "INVOICE" && preview.kind !== "RECEIPT" && preview.kind !== "UNKNOWN")) {
    await reject("Teklif, proforma, CV, yazışma veya ilgisiz belge. İnceleme kuyruğuna alınmadı.");
    return;
  }
  const reading = await analyze(input.bytes, input.fileName);
  if (reading.aiState === "FAILED" || reading.aiState === "WAITING_CONNECTION") {
    report.retryable += 1;
    report.errors.push("Görsel analiz tamamlanamadı. Belge kaybedilmeden yeniden denenecek.");
    return;
  }
  if (reading.kind === "STATEMENT") {
    await keepStatement(db, report, input, reading);
    return;
  }
  if (reading.kind !== "INVOICE" && reading.kind !== "RECEIPT" && reading.kind !== "UNKNOWN") {
    await reject("Teklif, proforma, CV, ekstre veya yazışma. Fatura kuyruğuna alınmadı.");
    return;
  }
  const vendor = reading.fields.vendor ?? "";
  const number = reading.fields.number ?? "";
  const identity = await knownIdentity(db, vendor, number);
  if (identity) {
    await duplicate(number, vendor, identity);
    return;
  }
  const draft = emptyDraft();
  draft.vendor = vendor;
  draft.number = number;
  draft.issuedOn = reading.fields.issuedOn ?? "";
  draft.amount = reading.fields.amount ?? "";
  draft.currency = reading.fields.currency ?? "";
  draft.tax = reading.fields.tax ?? "";
  draft.documentType = reading.kind === "INVOICE" || reading.kind === "RECEIPT" ? reading.kind : "";
  const queued = await queuePendingReview(db, {
    bytes: input.bytes,
    fileName: input.fileName,
    draft,
    missing: reading.review.filter((field) => field.state === "missing").map((field) => field.name),
    uncertain: reading.review.filter((field) => field.state === "uncertain").map((field) => field.name),
  });
  if (queued !== "queued") {
    await duplicate(number, vendor);
    return;
  }
  await remember(db, {
    gmailMessageId: input.messageId,
    attachmentId: input.attachmentId,
    threadId: input.threadId,
    outcome: "QUEUED",
  });
  const stored = await db.invoiceReview.findUnique({
    where: { contentHash: hash },
    select: {
      id: true,
      vendor: true,
      number: true,
      amount: true,
      currency: true,
      issuedOn: true,
      fileName: true,
      missingFields: true,
      uncertainFields: true,
      documentType: true,
    },
  });
  if (!stored) {
    report.queued += 1;
    report.imported.push({ messageId: input.messageId, number, vendor });
    return;
  }
  const savedDraft = { ...draft };
  const missingFields = stringList(stored.missingFields);
  const uncertainFields = stringList(stored.uncertainFields);
  if (commitActorId && canAutoApprove(savedDraft, missingFields, uncertainFields)) {
    const committed = await commitReadyReview(db, stored.id, commitActorId);
    if (committed === "approved" || committed === "drive-failed") {
      report.processed.push({
        reviewId: stored.id,
        vendor: stored.vendor ?? vendor,
        number: stored.number ?? number,
        amount: stored.amount?.toString() ?? draft.amount,
        currency: stored.currency ?? draft.currency,
        issuedOn: stored.issuedOn ? stored.issuedOn.toISOString().slice(0, 10) : draft.issuedOn,
        driveFailed: committed === "drive-failed",
      });
      return;
    }
  }
  const filled = { ...savedDraft, documentType: savedDraft.documentType || "INVOICE" };
  const reason = savedDraft.documentType !== "INVOICE" && savedDraft.documentType !== "RECEIPT"
    ? "Belgenin fatura olup olmadığı belirsiz."
    : `Eksik veya belirsiz: ${[...missingFields, ...uncertainFields].map((field) => REVIEW_LABELS[field ] ?? field).join(", ") || "alanlar"}.`;
  report.needsApproval.push({
    reviewId: stored.id,
    vendor: stored.vendor ?? vendor,
    number: stored.number ?? number,
    amount: stored.amount?.toString() ?? "",
    currency: stored.currency ?? "",
    fileName: stored.fileName,
    reason,
    canApprove: reviewIssues(filled).length === 0,
  });
  report.queued += 1;
  report.imported.push({ messageId: input.messageId, number, vendor });
}

async function keepStatement(
  db,
  report,
  input





,
  reading,
) {
  const draft = emptyDraft();
  draft.vendor = reading.fields.vendor ?? "";
  draft.number = reading.fields.number ?? "";
  draft.issuedOn = reading.fields.issuedOn ?? "";
  draft.amount = reading.fields.amount ?? "";
  draft.currency = reading.fields.currency ?? "";
  draft.tax = reading.fields.tax ?? "";
  draft.documentType = "STATEMENT";
  await queuePendingReview(db, {
    bytes: input.bytes,
    fileName: input.fileName,
    draft,
    missing: [],
    uncertain: [],
  });
  await remember(db, {
    gmailMessageId: input.messageId,
    attachmentId: input.attachmentId,
    threadId: input.threadId,
    outcome: "STATEMENT",
  });
  report.statements += 1;
}

async function knownDocument(db, hash) {
  const review = await db.invoiceReview.findUnique({
    where: { contentHash: hash },
    select: { invoiceId: true },
  });
  if (review) {
    return review.invoiceId ?? "review";
  }
  const document = await db.invoiceDocument.findFirst({
    where: { contentHash: hash },
    select: { invoiceId: true },
  });
  return document?.invoiceId ?? null;
}

async function knownIdentity(db, vendor, number) {
  if (vendor.trim().length < 2 || !number.trim()) {
    return null;
  }
  const key = vendorKey(vendor);
  const invoice = await db.invoice.findUnique({
    where: { vendorKey_number: { vendorKey: key, number: number.trim() } },
    select: { id: true },
  });
  if (invoice) {
    return invoice.id;
  }
  const reviews = await db.invoiceReview.findMany({
    where: { number: number.trim() },
    select: { invoiceId: true, vendor: true },
  });
  const match = reviews.find((row) => row.vendor && vendorKey(row.vendor) === key);
  return match ? match.invoiceId ?? "review" : null;
}

function storedInvoiceId(value) {
  return value && value !== "review" ? value : undefined;
}

export function invoiceSummary(report) {
  if (!report.connected) {
    return "Fatura taraması beklemede. Posta okunmadı ve dosya Drive'a yüklenmedi.";
  }
  const error = report.retryable > 0 ? " Görsel analiz yeniden denenecek." : "";
  return `Bulunan ${report.found}, işlenen ${report.processed.length}, onay bekleyen ${report.queued}, ekstre ${report.statements}, mükerrer ${report.duplicates.length}, elenen ${report.rejected.length}.${error}`;
}
