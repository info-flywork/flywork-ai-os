// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";

import { hashPassword } from "@/server/auth/password";
import { getPrisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { removeFinanceFile } from "@/server/finance/documents";
import { queuePendingReview } from "@/server/finance/reviewQueue";
import { emptyDraft } from "@/server/finance/reviewRules";
import { decideInvoiceReview, openReviewPdf } from "@/server/services/invoiceReview";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);

function pdf(marker) {
  return Buffer.from(`%PDF-1.4\n(${marker} ${randomUUID()})\n%%EOF`);
}

function readyDraft(number) {
  const draft = emptyDraft();
  draft.vendor = "Faz9 Denetim";
  draft.number = number;
  draft.amount = "10.00";
  draft.currency = "TRY";
  draft.documentType = "INVOICE";
  return draft;
}

async function expectCode(work, code) {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error ).code).toBe(code);
    return;
  }
  throw new Error(`Beklenen hata oluşmadı: ${code}`);
}

describe.skipIf(!databaseReady)("fatura inceleme veritabanı", () => {
  const userIds = [];

  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    const db = getPrisma();
    const reviews = await db.invoiceReview.findMany({
      where: { vendor: "Faz9 Denetim" },
      select: { id: true, storageKey: true, invoiceId: true },
    });
    const invoiceIds = reviews.flatMap((review) => review.invoiceId ? [review.invoiceId] : []);
    const documents = invoiceIds.length === 0
      ? []
      : await db.invoiceDocument.findMany({
        where: { invoiceId: { in: invoiceIds } },
        select: { storageKey: true },
      });
    for (const file of [...reviews, ...documents]) {
      await removeFinanceFile(file.storageKey);
    }
    if (reviews.length > 0) {
      await db.invoiceReview.deleteMany({ where: { id: { in: reviews.map((review) => review.id) } } });
    }
    if (invoiceIds.length > 0) {
      await db.expense.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await db.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    await db.invoice.deleteMany({ where: { vendorKey: { startsWith: "faz9" } } });
    if (userIds.length > 0) {
      await db.expense.deleteMany({ where: { userId: { in: userIds } } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  async function actor(role) {
    const db = getPrisma();
    const row = await db.user.create({
      data: {
        email: `faz9-${randomUUID()}@example.invalid`,
        name: role === "ADMIN" ? "Faz9 Yönetici" : "Faz9 Personel",
        passwordHash: await hashPassword(`Test-${randomBytes(6).toString("hex")}!a1`),
        role,
      },
    });
    userIds.push(row.id);
    return { id: row.id, role, email: row.email, name: row.name };
  }

  it("eksik tarihi engeller, tamamlanan onayda tek kayıt tutar ve Drive hatasını arşivlemez", async () => {
    const db = getPrisma();
    const admin = await actor("ADMIN");
    const invoicesBefore = await db.invoice.count();
    const expensesBefore = await db.expense.count();
    const bytes = pdf("faz9-onay");
    const queued = await queuePendingReview(db, {
      bytes,
      fileName: "faz9.pdf",
      draft: readyDraft("FW-FAZ9-1"),
      missing: ["issuedOn"],
      uncertain: ["tax"],
    });
    expect(queued).toBe("queued");
    expect(await db.invoice.count()).toBe(invoicesBefore);
    expect(await db.expense.count()).toBe(expensesBefore);
    const review = await db.invoiceReview.findFirstOrThrow({
      where: { contentHash: { not: "" }, vendor: "Faz9 Denetim", number: "FW-FAZ9-1" },
    });
    expect(review.issuedOn).toBeNull();
    expect(review.uncertainFields).toContain("tax");

    const blocked = readyDraft("FW-FAZ9-1");
    await expectCode(
      () => decideInvoiceReview(admin, review.id, "approve", blocked, async () => "olmamali"),
      "VALIDATION",
    );
    expect(await db.invoice.count()).toBe(invoicesBefore);

    const completed = readyDraft("FW-FAZ9-1");
    completed.issuedOn = "2026-10-21";
    let uploads = 0;
    const upload = async (input) => {
      uploads += 1;
      expect(input.folder).toBe("Flywork/Faturalar/2026/10");
      expect(input.bytes.subarray(0, 4).toString("utf8")).toBe("%PDF");
      if (uploads === 1) {
        throw new Error("Drive isteği başarısız (503).");
      }
      return "drive-faz9";
    };
    const failed = await decideInvoiceReview(admin, review.id, "approve", completed, upload);
    expect(failed.outcome).toBe("drive-failed");
    const afterFailure = await db.invoiceReview.findUniqueOrThrow({ where: { id: review.id } });
    expect(afterFailure.status).toBe("DRIVE_FAILED");
    expect(afterFailure.archived).toBe(false);
    expect(afterFailure.driveFileId).toBeNull();
    expect(afterFailure.invoiceId).toBeTruthy();
    expect(await db.invoice.count()).toBe(invoicesBefore + 1);
    expect(await db.expense.count({ where: { invoiceId: afterFailure.invoiceId ?? "" } })).toBe(1);

    const retried = await decideInvoiceReview(admin, review.id, "approve", completed, upload);
    expect(retried.outcome).toBe("approved");
    expect(retried.invoiceId).toBe(afterFailure.invoiceId);
    expect(uploads).toBe(2);
    const approved = await db.invoiceReview.findUniqueOrThrow({ where: { id: review.id } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.archived).toBe(true);
    expect(approved.driveFileId).toBe("drive-faz9");
    expect(await db.invoiceDocument.count({ where: { invoiceId: approved.invoiceId ?? "" } })).toBe(1);
    expect(await db.invoice.count()).toBe(invoicesBefore + 1);

    const again = await decideInvoiceReview(admin, review.id, "approve", completed, upload);
    expect(again.outcome).toBe("already");
    expect(uploads).toBe(2);
    expect(await db.invoice.count()).toBe(invoicesBefore + 1);

    const audit = await db.invoiceReviewAudit.findFirstOrThrow({
      where: { reviewId: review.id, action: "DRIVE_FAILED" },
    });
    expect(audit.actorId).toBe(admin.id);
    expect(audit.corrections).toMatchObject({ issuedOn: { once: "", sonra: "2026-10-21" } });
    expect(await db.expense.count()).toBe(expensesBefore + 1);
  });

  it("aynı tedarikçi ve belge numarasını ikinci kez kaydetmez", async () => {
    const db = getPrisma();
    const admin = await actor("ADMIN");
    const first = await queuePendingReview(db, {
      bytes: pdf("faz9-ilk"),
      fileName: "ilk.pdf",
      draft: { ...readyDraft("FW-FAZ9-2"), issuedOn: "2026-10-21" },
      missing: [],
      uncertain: [],
    });
    const second = await queuePendingReview(db, {
      bytes: pdf("faz9-ikinci"),
      fileName: "ikinci.pdf",
      draft: { ...readyDraft("FW-FAZ9-2"), issuedOn: "2026-10-21" },
      missing: [],
      uncertain: [],
    });
    expect(first).toBe("queued");
    expect(second).toBe("queued");
    const rows = await db.invoiceReview.findMany({ where: { number: "FW-FAZ9-2" }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    const upload = async () => "drive-faz9-2";
    const approved = await decideInvoiceReview(
      admin,
      rows[0].id,
      "approve",
      { ...readyDraft("FW-FAZ9-2"), issuedOn: "2026-10-21" },
      upload,
    );
    expect(approved.outcome).toBe("approved");
    const before = await db.invoice.count({ where: { number: "FW-FAZ9-2" } });
    await expectCode(
      () => decideInvoiceReview(admin, rows[1].id, "approve", { ...readyDraft("FW-FAZ9-2"), issuedOn: "2026-10-21" }, upload),
      "CONFLICT",
    );
    expect(await db.invoice.count({ where: { number: "FW-FAZ9-2" } })).toBe(before);
  });

  it("kayıtlı dosya özetini yeniden onaylamaz", async () => {
    const db = getPrisma();
    const admin = await actor("ADMIN");
    const bytes = pdf("faz9-ozet");
    await queuePendingReview(db, {
      bytes,
      fileName: "ozet.pdf",
      draft: { ...readyDraft("FW-FAZ9-3"), issuedOn: "2026-10-21" },
      missing: [],
      uncertain: [],
    });
    const review = await db.invoiceReview.findFirstOrThrow({ where: { number: "FW-FAZ9-3" } });
    const invoice = await db.invoice.create({
      data: {
        number: "FW-FAZ9-ARSIV",
        vendor: "Faz9 Denetim",
        vendorKey: "faz9 denetim arsiv",
        scope: "COMPANY",
        amount: "5.00",
        currency: "TRY",
        issuedOn: new Date("2026-10-21T00:00:00.000Z"),
        source: "UPLOAD",
      },
    });
    await db.invoiceDocument.create({
      data: {
        invoiceId: invoice.id,
        storageKey: randomBytes(16).toString("hex"),
        fileName: "arsiv.pdf",
        contentType: "application/pdf",
        sizeBytes: 4,
        contentHash: review.contentHash,
      },
    });
    const before = await db.invoice.count();
    await expectCode(
      () => decideInvoiceReview(admin, review.id, "approve", { ...readyDraft("FW-FAZ9-3"), issuedOn: "2026-10-21" }, async () => "olmamali"),
      "CONFLICT",
    );
    expect(await db.invoice.count()).toBe(before);
    await removeFinanceFile((await db.invoiceDocument.findFirstOrThrow({ where: { invoiceId: invoice.id } })).storageKey);
  });

  it("personelin onayına ve PDF erişimine izin vermez", async () => {
    const db = getPrisma();
    const employee = await actor("EMPLOYEE");
    await queuePendingReview(db, {
      bytes: pdf("faz9-yetki"),
      fileName: "yetki.pdf",
      draft: { ...readyDraft("FW-FAZ9-4"), issuedOn: "2026-10-21" },
      missing: [],
      uncertain: [],
    });
    const review = await db.invoiceReview.findFirstOrThrow({ where: { number: "FW-FAZ9-4" } });
    const before = await db.invoice.count();
    await expectCode(
      () => decideInvoiceReview(employee, review.id, "approve", { ...readyDraft("FW-FAZ9-4"), issuedOn: "2026-10-21" }, async () => "olmamali"),
      "FORBIDDEN",
    );
    await expectCode(() => openReviewPdf(employee, review.id), "FORBIDDEN");
    expect(await db.invoice.count()).toBe(before);
  });

  it("reddedilen belgeden fatura açmaz", async () => {
    const db = getPrisma();
    const admin = await actor("ADMIN");
    await queuePendingReview(db, {
      bytes: pdf("faz9-red"),
      fileName: "red.pdf",
      draft: readyDraft("FW-FAZ9-5"),
      missing: ["issuedOn"],
      uncertain: [],
    });
    const review = await db.invoiceReview.findFirstOrThrow({ where: { number: "FW-FAZ9-5" } });
    const before = await db.invoice.count();
    const rejected = await decideInvoiceReview(admin, review.id, "reject", readyDraft("FW-FAZ9-5"));
    expect(rejected.outcome).toBe("rejected");
    expect(await db.invoice.count()).toBe(before);
    expect((await db.invoiceReview.findUniqueOrThrow({ where: { id: review.id } })).status).toBe("REJECTED");
  });
});
