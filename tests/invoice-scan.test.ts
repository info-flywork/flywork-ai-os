// @vitest-environment node
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "@/server/db";
import { removeFinanceFile } from "@/server/finance/documents";
import { readFinanceDocument, type DocumentReadResult } from "@/server/finance/readDocument";
import { importGmailInvoices, InvoiceScanRetryError } from "@/server/google/invoices";
import { GMAIL_QUERIES, type GmailApi, type GmailPdfPart } from "@/server/google/gmail";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const vendor = "Faz10 Tarama";

function pdf(body: string) {
  return Buffer.from(`%PDF-1.4\n${body}\n%%EOF`);
}

function invoicePdf(number: string, marker = number) {
  return pdf(`(Fatura No: ${number})\n(Tedarikci: ${vendor})\n(2026-10-21)\n(150.00 TRY)\n(${marker})`);
}

function gmail(files: Record<string, GmailPdfPart[]>): GmailApi {
  return {
    async profile() {
      return { emailAddress: "faz10@example.invalid" };
    },
    async listMessages(query) {
      if (query !== GMAIL_QUERIES.invoices) {
        return { messages: [] };
      }
      return { messages: Object.keys(files).map((id) => ({ id, threadId: id })) };
    },
    async getMetadata(id) {
      return { id, threadId: id, from: "", subject: "", date: "" };
    },
    async listPdfAttachments(id) {
      return { threadId: id, attachments: files[id] ?? [] };
    },
    async getAttachment() {
      throw new Error("ek verisi zaten var");
    },
  };
}

function textAnalyze(bytes: Buffer, fileName: string) {
  return Promise.resolve(readFinanceDocument(bytes, fileName));
}

describe.skipIf(!databaseReady)("gmail fatura taraması", () => {
  const messageIds: string[] = [];

  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    const db = getPrisma();
    const reviews = await db.invoiceReview.findMany({
      where: { vendor },
      select: { storageKey: true },
    });
    for (const review of reviews) {
      await removeFinanceFile(review.storageKey);
    }
    await db.invoiceReview.deleteMany({ where: { vendor } });
    if (messageIds.length > 0) {
      await db.gmailProcessedItem.deleteMany({ where: { gmailMessageId: { in: messageIds } } });
    }
  });

  it("yeni faturayı kuyruğa alır, aynı dosyayı ve onaylı kaydı yeniden eklemez", async () => {
    const db = getPrisma();
    const invoicesBefore = await db.invoice.count();
    const expensesBefore = await db.expense.count();
    const number = `FW-FAZ10-${randomUUID().slice(0, 8)}`;
    const bytes = invoicePdf(number);
    const firstId = `faz10-${randomUUID()}`;
    const repeatId = `faz10-${randomUUID()}`;
    messageIds.push(firstId, repeatId);
    let analyzed = 0;
    const first = await importGmailInvoices(db, gmail({
      [firstId]: [{ filename: "fatura.pdf", attachmentId: "ek-1", data: bytes }],
    }), {
      analyze: async (file, fileName) => {
        analyzed += 1;
        return textAnalyze(file, fileName);
      },
    });
    expect(first.queued).toBe(1);
    expect(first.driveUploaded).toBe(false);
    expect(analyzed).toBe(1);
    const review = await db.invoiceReview.findFirst({ where: { number, vendor } });
    expect(review?.status).toBe("PENDING");
    expect(review?.missingFields).not.toContain("amount");

    const second = await importGmailInvoices(db, gmail({
      [firstId]: [{ filename: "fatura.pdf", attachmentId: "ek-1", data: bytes }],
      [repeatId]: [{ filename: "fatura.pdf", attachmentId: "ek-2", data: bytes }],
    }), {
      analyze: async () => {
        analyzed += 1;
        throw new Error("ikinci analiz çalışmamalı");
      },
    });
    expect(second.queued).toBe(0);
    expect(analyzed).toBe(1);
    expect(await db.invoiceReview.count({ where: { number, vendor } })).toBe(1);

    await db.invoiceReview.update({ where: { id: review?.id }, data: { status: "APPROVED" } });
    const approvedId = `faz10-${randomUUID()}`;
    messageIds.push(approvedId);
    const third = await importGmailInvoices(db, gmail({
      [approvedId]: [{ filename: "fatura.pdf", attachmentId: "ek-3", data: bytes }],
    }), {
      analyze: async () => {
        analyzed += 1;
        throw new Error("onaylı belge yeniden okunmamalı");
      },
    });
    expect(third.queued).toBe(0);
    expect(analyzed).toBe(1);
    expect((await db.invoiceReview.findFirst({ where: { number, vendor } }))?.status).toBe("APPROVED");
    expect(await db.invoice.count()).toBe(invoicesBefore);
    expect(await db.expense.count()).toBe(expensesBefore);
  });

  it("proformayı kuyruğa almaz ve OpenAI hatasında belgeyi saklar", async () => {
    const db = getPrisma();
    const proId = `faz10-${randomUUID()}`;
    const failId = `faz10-${randomUUID()}`;
    messageIds.push(proId, failId);
    const number = `FW-FAZ10-${randomUUID().slice(0, 8)}`;
    const bytes = invoicePdf(number, randomUUID());
    let calls = 0;
    const analyze = async (file: Buffer, fileName: string): Promise<DocumentReadResult> => {
      calls += 1;
      if (calls === 1) {
        const failed = readFinanceDocument(file, fileName);
        return { ...failed, aiState: "FAILED", warnings: ["Görsel analiz tamamlanamadı."] };
      }
      return textAnalyze(file, fileName);
    };
    const mailbox = gmail({
      [proId]: [{ filename: "proforma-teklif.pdf", attachmentId: "ek-p", data: pdf("(Proforma teklif)") }],
      [failId]: [{ filename: "fatura.pdf", attachmentId: "ek-f", data: bytes }],
    });
    await expect(importGmailInvoices(db, mailbox, { analyze })).rejects.toBeInstanceOf(InvoiceScanRetryError);
    expect(await db.invoiceReview.count({ where: { number } })).toBe(0);
    expect(await db.gmailProcessedItem.findFirst({ where: { gmailMessageId: failId } })).toBeNull();
    expect(await db.gmailProcessedItem.findFirst({ where: { gmailMessageId: proId, outcome: "REJECTED" } })).not.toBeNull();

    const retried = await importGmailInvoices(db, mailbox, { analyze });
    expect(retried.queued).toBe(1);
    expect(await db.invoiceReview.count({ where: { number, status: "PENDING" } })).toBe(1);
    expect(calls).toBe(2);
  });

  it("aynı tedarikçi ve belge numarasını ikinci kez kuyruğa almaz", async () => {
    const db = getPrisma();
    const number = `FW-FAZ10-${randomUUID().slice(0, 8)}`;
    const firstId = `faz10-${randomUUID()}`;
    const secondId = `faz10-${randomUUID()}`;
    messageIds.push(firstId, secondId);
    const firstBytes = invoicePdf(number, randomUUID());
    const secondBytes = invoicePdf(number, randomUUID());
    await importGmailInvoices(db, gmail({
      [firstId]: [{ filename: "fatura.pdf", attachmentId: "ek-1", data: firstBytes }],
    }), { analyze: textAnalyze });
    const again = await importGmailInvoices(db, gmail({
      [secondId]: [{ filename: "fatura-2.pdf", attachmentId: "ek-2", data: secondBytes }],
    }), { analyze: textAnalyze });
    expect(again.queued).toBe(0);
    expect(again.duplicates.map((row) => row.messageId)).toContain(secondId);
    expect(await db.invoiceReview.count({ where: { number, vendor } })).toBe(1);
  });

  it("kart ekstresini fatura kuyruğuna almadan saklar", async () => {
    const db = getPrisma();
    const id = `faz10-${randomUUID()}`;
    messageIds.push(id);
    const bytes = pdf("(Sirket Kredi Karti Hesap Ozeti)\n(Kart Numarasi)\n(Hesap Ozeti Borcu)\n(Hesap Kesim Tarihi)\n(Son Odeme Tarihi)");
    let analyzed = 0;
    const scan = await importGmailInvoices(db, gmail({
      [id]: [{ filename: "belge.pdf", attachmentId: "ek-s", data: bytes }],
    }), {
      analyze: async () => {
        analyzed += 1;
        throw new Error("ekstre için model çağrılmamalı");
      },
    });
    expect(scan.queued).toBe(0);
    expect(scan.statements).toBe(1);
    expect(analyzed).toBe(0);
    const review = await db.invoiceReview.findFirst({ where: { fileName: "belge.pdf", documentType: "STATEMENT" } });
    expect(review?.status).toBe("PENDING");
    expect(review?.invoiceId).toBeNull();
    expect(review?.driveFileId).toBeNull();
    await removeFinanceFile(review?.storageKey ?? "");
    await db.invoiceReview.deleteMany({ where: { id: review?.id ?? "" } });
  });

  it("fişi inceleme kuyruğuna alır", async () => {
    const db = getPrisma();
    const id = `faz10-${randomUUID()}`;
    messageIds.push(id);
    const bytes = pdf("(Receipt)\n(Makbuz No: R-10)\n(Satici: Faz10 Tarama)\n(Toplam odeme 25.00 USD)\n(Nakit tahsilat belgesi)");
    const scan = await importGmailInvoices(db, gmail({
      [id]: [{ filename: "fis.pdf", attachmentId: "ek-r", data: bytes }],
    }), { analyze: textAnalyze });
    expect(scan.queued).toBe(1);
    expect(scan.statements).toBe(0);
    const review = await db.invoiceReview.findFirst({ where: { fileName: "fis.pdf", documentType: "RECEIPT" } });
    expect(review?.documentType).toBe("RECEIPT");
    expect(review?.status).toBe("PENDING");
  });

  it("reddedilmiş belgeyi yeniden kuyruğa almaz", async () => {
    const db = getPrisma();
    const number = `FW-FAZ10-${randomUUID().slice(0, 8)}`;
    const bytes = invoicePdf(number, randomUUID());
    const firstId = `faz10-${randomUUID()}`;
    const againId = `faz10-${randomUUID()}`;
    messageIds.push(firstId, againId);
    await importGmailInvoices(db, gmail({
      [firstId]: [{ filename: "fatura.pdf", attachmentId: "ek-1", data: bytes }],
    }), { analyze: textAnalyze });
    const review = await db.invoiceReview.findFirstOrThrow({ where: { number } });
    await db.invoiceReview.update({ where: { id: review.id }, data: { status: "REJECTED" } });
    const again = await importGmailInvoices(db, gmail({
      [againId]: [{ filename: "fatura.pdf", attachmentId: "ek-2", data: bytes }],
    }), {
      analyze: async () => {
        throw new Error("reddedilen belge yeniden okunmamalı");
      },
    });
    expect(again.queued).toBe(0);
    expect(await db.invoiceReview.count({ where: { number } })).toBe(1);
    expect((await db.invoiceReview.findFirst({ where: { number } }))?.status).toBe("REJECTED");
  });

  it("bir iletinin Gmail zaman aşımı diğer faturayı düşürmez", async () => {
    const db = getPrisma();
    const slowId = `faz10-${randomUUID()}`;
    const okId = `faz10-${randomUUID()}`;
    messageIds.push(slowId, okId);
    const number = `FW-FAZ10-${randomUUID().slice(0, 8)}`;
    const mailbox = gmail({
      [slowId]: [],
      [okId]: [{ filename: "fatura.pdf", attachmentId: "ek-ok", data: invoicePdf(number) }],
    });
    mailbox.listPdfAttachments = async (id) => {
      if (id === slowId) {
        throw new Error("Gmail yanıt vermedi.");
      }
      return { threadId: id, attachments: id === okId ? [{ filename: "fatura.pdf", attachmentId: "ek-ok", data: invoicePdf(number) }] : [] };
    };
    await expect(importGmailInvoices(db, mailbox, { analyze: textAnalyze })).rejects.toThrow(/Posta değiştirilmedi/);
    expect(await db.invoiceReview.count({ where: { number } })).toBe(1);
    expect(await db.gmailProcessedItem.findFirst({ where: { gmailMessageId: slowId } })).toBeNull();
  });
});
