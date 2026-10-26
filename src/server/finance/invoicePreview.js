
import { vendorKey } from "@/server/finance/catalog";
import { aiDocumentEnv } from "@/server/finance/documentAi";
import { analyzeFinanceDocument } from "@/server/finance/readDocument";
import { queuePendingReview } from "@/server/finance/reviewQueue";
import { emptyDraft } from "@/server/finance/reviewRules";
import { accessTokenFor } from "@/server/google/account";
import { createGmailApi, listMessageIds } from "@/server/google/gmail";



const FIELD_LABELS = {
  vendor: "Tedarikçi",
  number: "Fatura no",
  issuedOn: "Tarih",
  amount: "Tutar",
  currency: "Para birimi",
  tax: "Vergi",
  documentType: "Belge türü",
};

const REQUIRED = ["vendor", "number", "issuedOn", "amount", "currency"] ;

 



































export async function runControlledInvoicePreview(db) {
  const beforeInvoices = await db.invoice.count();
  const beforeExpenses = await db.expense.count();
  const ai = aiDocumentEnv();
  const base = {
    connected: false,
    opened: false,
    candidateMessages: 0,
    documents: 0,
    readable: 0,
    confirmedInvoices: 0,
    confirmedReceipts: 0,
    excluded: 0,
    unreadable: 0,
    aiState: "NOT_RUN",
    aiMissing: ai.missing,
    items: [],
    noticeSaved: false,
    invoiceCountUnchanged: true,
    expenseCountUnchanged: true,
  };
  const access = await accessTokenFor(db);
  if (!access) {
    return finish(db, base, beforeInvoices, beforeExpenses);
  }
  const gmail = createGmailApi(access.token);
  const after = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const ids = await listMessageIds(gmail, `after:${after} has:attachment filename:pdf`, 100);
  const candidates = [];
  for (const id of ids) {
    const meta = await gmail.getMetadata(id);
    const files = await gmail.listPdfAttachments(id);
    const names = files.attachments.map((item) => item.filename).join("\n");
    if (files.attachments.length === 0 || blocked(meta.subject) || blocked(names)) {
      continue;
    }
    candidates.push(id);
  }
  base.connected = true;
  base.candidateMessages = candidates.length;
  if (candidates.length !== 2) {
    return finish(db, base, beforeInvoices, beforeExpenses);
  }

  const lines = [
    "Önizleme inceleme kuyruğuna alındı. Onay verilmeden fatura kaydı ve Drive yüklemesi yapılmaz.",
    ai.configured ? "AI belge okuyucu bağlı." : `Bağlantı bekleniyor. Eksik: ${ai.missing.join(", ")}.`,
  ];
  let documentNumber = 0;
  for (const id of candidates) {
    const files = await gmail.listPdfAttachments(id);
    for (const file of files.attachments) {
      if (!file.attachmentId || !file.filename.toLowerCase().endsWith(".pdf")) {
        continue;
      }
      documentNumber += 1;
      const bytes = await gmail.getAttachment(id, file.attachmentId);
      const reading = await analyzeFinanceDocument(bytes, file.filename, { useVision: true });
      await queuePendingReview(db, {
        bytes,
        fileName: file.filename,
        draft: draftFromReading(reading),
        missing: reading.review.filter((field) => field.state === "missing").map((field) => field.name),
        uncertain: reading.review.filter((field) => field.state === "uncertain").map((field) => field.name),
      });
      const item = await previewItem(db, reading);
      base.items.push(item);
      base.documents += 1;
      if (item.layer === "READABLE") {
        base.readable += 1;
      } else if (!item.excluded) {
        base.unreadable += 1;
      }
      if (item.confirmedInvoice) {
        base.confirmedInvoices += 1;
      }
      if (item.confirmedReceipt) {
        base.confirmedReceipts += 1;
      }
      if (item.excluded) {
        base.excluded += 1;
      }
      lines.push(`${documentNumber}. ${previewLine(reading, item)}`);
    }
  }
  base.opened = true;
  base.aiState = base.items.some((item) => item.aiState === "WAITING_CONNECTION")
    ? "WAITING_CONNECTION"
    : base.items.some((item) => item.aiState === "FAILED")
      ? "FAILED"
      : base.items.some((item) => item.aiState === "READ")
        ? "READ"
        : "NOT_NEEDED";
  await db.panelNotice.deleteMany({ where: { title: "Fatura önizlemesi" } });
  await db.panelNotice.create({
    data: {
      dedupeKey: "gmail.invoice-preview",
      title: "Fatura önizlemesi",
      body: lines.join("\n"),
      channel: "PANEL",
      delivered: false,
    },
  });
  base.noticeSaved = true;
  return finish(db, base, beforeInvoices, beforeExpenses);
}

async function previewItem(db, reading) {
  const byHash = await db.invoiceDocument.findFirst({
    where: { contentHash: reading.contentHash },
    select: { id: true },
  });
  let duplicateVendorNumber = null;
  if (reading.fields.vendor && reading.fields.number) {
    const existing = await db.invoice.findUnique({
      where: { vendorKey_number: { vendorKey: vendorKey(reading.fields.vendor), number: reading.fields.number } },
      select: { id: true },
    });
    duplicateVendorNumber = Boolean(existing);
  }
  const missing = reading.review.filter((field) => field.state === "missing").map((field) => FIELD_LABELS[field.name]);
  const uncertain = reading.review.filter((field) => field.state === "uncertain").map((field) => FIELD_LABELS[field.name]);
  const confirmedInvoice = reading.kind === "INVOICE" && REQUIRED.every((name) => Boolean(reading.fields[name]));
  const confirmedReceipt = reading.kind === "RECEIPT" && REQUIRED.every((name) => Boolean(reading.fields[name]));
  return {
    layer: reading.textLayer,
    engine: reading.engine,
    pdfjs: reading.pdfjs,
    images: reading.images,
    contentStreams: reading.contentStreams,
    kind: reading.kind,
    aiState: reading.aiState,
    confirmedInvoice,
    confirmedReceipt,
    excluded: reading.kind === "NOT_INVOICE",
    failure: reading.aiState === "FAILED" ? (reading.warnings[0] ?? "Görsel analiz tamamlanamadı.") : null,
    missing,
    uncertain,
    duplicateHash: Boolean(byHash),
    duplicateVendorNumber,
  };
}

function previewLine(reading, item) {
  const structure = item.layer === "READABLE"
    ? "Metin katmanı okundu."
    : reading.images > 0 && reading.contentStreams === 0
      ? "Metin katmanı yok; belge görsel."
      : reading.pdfjs === "failed"
        ? "PDF metin çözücü hata verdi."
        : "Metin katmanı çözülemedi.";
  const status = item.excluded
    ? "Elendi"
    : item.confirmedInvoice
      ? "Gerçek fatura"
      : item.layer === "READABLE"
        ? "Okundu, inceleme gerekli"
        : "Okunamadı";
  const fields = (Object.keys(FIELD_LABELS) ).map((name) => {
    const review = reading.review.find((field) => field.name === name);
    if (review?.state === "uncertain") {
      return `${FIELD_LABELS[name]}: belirsiz`;
    }
    if (!reading.fields[name]) {
      return `${FIELD_LABELS[name]}: eksik`;
    }
    const value = name === "documentType" ? kindLabel(reading.fields.documentType) : reading.fields[name];
    return `${FIELD_LABELS[name]}: ${value}`;
  });
  const vendorDuplicate = item.duplicateVendorNumber === null
    ? "Tedarikçi ve numara: kontrol edilemedi"
    : item.duplicateVendorNumber
      ? "Tedarikçi ve numara mükerrer: evet"
      : "Tedarikçi ve numara mükerrer: hayır";
  return `${status}. ${structure} ${fields.join(". ")}. Hash mükerrer: ${item.duplicateHash ? "evet" : "hayır"}. ${vendorDuplicate}.`;
}

function kindLabel(kind) {
  if (kind === "INVOICE") {
    return "fatura";
  }
  if (kind === "RECEIPT") {
    return "fiş";
  }
  if (kind === "NOT_INVOICE") {
    return "fatura değil";
  }
  return "bilinmiyor";
}

function blocked(value) {
  const lowered = value.toLocaleLowerCase("tr");
  return (
    ["özgeçmiş", "ozgecmis", "curriculum vitae", "proforma", "teklif"].some((term) => lowered.includes(term)) ||
    /(^|[^a-z])cv([^a-z]|$)/i.test(value)
  );
}

async function finish(
  db,
  report,
  beforeInvoices,
  beforeExpenses,
) {
  report.invoiceCountUnchanged = (await db.invoice.count()) === beforeInvoices;
  report.expenseCountUnchanged = (await db.expense.count()) === beforeExpenses;
  return report;
}

function draftFromReading(reading) {
  const draft = emptyDraft();
  draft.vendor = reading.fields.vendor ?? "";
  draft.number = reading.fields.number ?? "";
  draft.issuedOn = reading.fields.issuedOn ?? "";
  draft.amount = reading.fields.amount ?? "";
  draft.currency = reading.fields.currency ?? "";
  draft.tax = reading.fields.tax ?? "";
  draft.documentType = reading.kind === "UNKNOWN" ? "" : reading.kind;
  return draft;
}
