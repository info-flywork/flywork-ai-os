// @vitest-environment node
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "@/server/db";
import { removeFinanceFile } from "@/server/finance/documents";
import { runGmailAnalysis } from "@/server/automation/handlers";
import { openSecret, sealSecret } from "@/server/google/cipher";
import { DRIVE_FILE_SCOPE, GMAIL_READONLY_SCOPE, type GoogleEnv } from "@/server/google/config";
import { GMAIL_QUERIES, type GmailApi } from "@/server/google/gmail";
import { importGmailInvoices } from "@/server/google/invoices";
import { readFinanceDocument } from "@/server/finance/readDocument";
import { accessTokenFor, connectFromAuthorizationCode, disconnectGoogle } from "@/server/google/account";
import { GoogleOAuthError } from "@/server/google/oauth";

loadEnvConfig(process.cwd());

const databaseReady = Boolean(process.env.DATABASE_URL);
const ACCOUNT_EMAIL = "faz8-google@example.invalid";
const config: GoogleEnv = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost:3010/api/google/oauth/callback",
  missing: [],
  configured: true,
};
const adminEmail = "faz8-yonetici@example.invalid";
const noticeKeys: string[] = [];

const invoicePdf = Buffer.from(
  "%PDF-1.4\n(Fatura No: FW-FAZ8)\n(Tedarikci: Faz8 Ornek)\n(2099-01-15)\n(10.00 TRY)\n%%EOF",
);
const proformaPdf = Buffer.from("%PDF-1.4\n(Proforma teklif)\n%%EOF");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe.skipIf(!databaseReady)("google veritabanı", () => {
  afterAll(async () => {
    if (!databaseReady) {
      return;
    }
    const db = getPrisma();
    const invoices = await db.invoice.findMany({
      where: { vendor: { startsWith: "Faz8" } },
      include: { document: true },
    });
    for (const invoice of invoices) {
      if (invoice.document) {
        await removeFinanceFile(invoice.document.storageKey);
      }
    }
    await db.invoice.deleteMany({ where: { vendor: { startsWith: "Faz8" } } });
    const reviews = await db.invoiceReview.findMany({
      where: { OR: [{ vendor: { startsWith: "Faz8" } }, { number: "FW-FAZ8" }] },
      select: { storageKey: true },
    });
    for (const review of reviews) {
      await removeFinanceFile(review.storageKey);
    }
    await db.invoiceReview.deleteMany({ where: { OR: [{ vendor: { startsWith: "Faz8" } }, { number: "FW-FAZ8" }] } });
    await db.gmailProcessedItem.deleteMany({ where: { gmailMessageId: { startsWith: "faz8-" } } });
    await db.driveFolder.deleteMany({
      where: {
        OR: [
          { path: { startsWith: "Flywork/Faturalar/2099" } },
          { driveId: { startsWith: "faz8-folder-" } },
        ],
      },
    });
    if (noticeKeys.length > 0) {
      await db.panelNotice.deleteMany({ where: { dedupeKey: { in: noticeKeys } } });
    }
    await db.googleAccount.deleteMany({ where: { email: ACCOUNT_EMAIL } });
    await db.user.deleteMany({ where: { email: adminEmail } });
  });

  it("oauth kodunu şifreler, eksik izni kaydetmez ve çalışan gibi davranmaz", async () => {
    const db = getPrisma();
    const existing = await db.googleAccount.findUnique({ where: { id: "default" } });
    if (existing && existing.email !== ACCOUNT_EMAIL) {
      throw new Error("Test, kayıtlı Google hesabının üzerine yazmadı.");
    }
    const narrow = async () =>
      jsonResponse({
        access_token: "access-faz8",
        refresh_token: "refresh-faz8",
        expires_in: 3600,
        scope: GMAIL_READONLY_SCOPE,
      });
    const admin = await db.user.upsert({
      where: { email: adminEmail },
      update: { role: "ADMIN", active: true },
      create: {
        email: adminEmail,
        name: "Faz8 Yonetici",
        role: "ADMIN",
        passwordHash: "scrypt$faz8$not-used",
      },
      select: { id: true },
    });
    await expect(
      connectFromAuthorizationCode(db, { code: "kod-faz8", connectedById: admin.id }, narrow, config),
    ).rejects.toBeInstanceOf(GoogleOAuthError);
    expect(await db.googleAccount.count({ where: { email: ACCOUNT_EMAIL } })).toBe(0);

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return jsonResponse({
          access_token: "access-faz8",
          refresh_token: "refresh-faz8",
          expires_in: 3600,
          scope: `${GMAIL_READONLY_SCOPE} ${DRIVE_FILE_SCOPE}`,
        });
      }
      if (url.endsWith("/profile")) {
        return jsonResponse({ emailAddress: ACCOUNT_EMAIL });
      }
      throw new Error("beklenmeyen google isteği");
    };
    const connected = await connectFromAuthorizationCode(
      db,
      { code: "kod-faz8", connectedById: admin.id },
      fetchImpl,
      config,
    );
    expect(connected.email).toBe(ACCOUNT_EMAIL);
    const stored = await db.googleAccount.findUnique({ where: { id: "default" } });
    expect(stored?.status).toBe("CONNECTED");
    expect(stored?.refreshTokenCipher).not.toContain("refresh-faz8");
    expect(stored?.accessTokenCipher).not.toContain("access-faz8");
    expect(openSecret(stored?.refreshTokenCipher ?? "")).toBe("refresh-faz8");
    expect(stored?.connectedById).toBe(admin.id);
  });

  it("süresi dolan erişimi yeniler, geçersiz anahtarda bağlantıyı düşürür", async () => {
    const db = getPrisma();
    await db.googleAccount.update({
      where: { id: "default" },
      data: {
        accessTokenExpiresAt: new Date(Date.now() - 120_000),
        refreshTokenCipher: sealSecret("refresh-faz8"),
        status: "CONNECTED",
      },
    });
    let calls = 0;
    const renewed = await accessTokenFor(
      db,
      async () => {
        calls += 1;
        return jsonResponse({ access_token: "access-faz8-yeni", expires_in: 3600, token_type: "Bearer" });
      },
      config,
    );
    expect(renewed?.token).toBe("access-faz8-yeni");
    expect(calls).toBe(1);
    const stored = await db.googleAccount.findUnique({ where: { id: "default" } });
    expect(stored?.accessTokenCipher).not.toContain("access-faz8-yeni");
    expect(openSecret(stored?.accessTokenCipher ?? "")).toBe("access-faz8-yeni");
    const cached = await accessTokenFor(db, async () => {
      throw new Error("taze anahtar varken yenileme olmamalı");
    }, config);
    expect(cached?.token).toBe("access-faz8-yeni");

    await db.googleAccount.update({
      where: { id: "default" },
      data: { accessTokenExpiresAt: new Date(Date.now() - 120_000) },
    });
    const lost = await accessTokenFor(
      db,
      async () => jsonResponse({ error: "invalid_grant" }, 400),
      config,
    );
    expect(lost).toBeNull();
    const broken = await db.googleAccount.findUnique({ where: { id: "default" } });
    expect(broken?.status).toBe("ERROR");
    expect(openSecret(broken?.refreshTokenCipher ?? "")).toBe("");
    expect(broken?.lastError).toContain("yeniden bağlayın");
  });

  it("gmail sayfalarını bir kez işler ve gövdeyi özete yazmaz", async () => {
    const db = getPrisma();
    await db.googleAccount.update({
      where: { id: "default" },
      data: {
        email: ACCOUNT_EMAIL,
        status: "CONNECTED",
        refreshTokenCipher: sealSecret("refresh-faz8"),
        accessTokenCipher: sealSecret("access-faz8"),
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        lastError: null,
      },
    });
    let metadataCalls = 0;
    const gmail: GmailApi = {
      async profile() {
        return { emailAddress: ACCOUNT_EMAIL };
      },
      async listMessages(query, pageToken) {
        if (query !== GMAIL_QUERIES.important) {
          return { messages: [] };
        }
        if (!pageToken) {
          return {
            messages: [
              { id: "faz8-m1", threadId: "t" },
              { id: "faz8-m2", threadId: "t" },
            ],
            nextPageToken: "sayfa-2",
          };
        }
        return { messages: [{ id: "faz8-m3", threadId: "t" }] };
      },
      async getMetadata(id) {
        metadataCalls += 1;
        return { id, threadId: "t", from: "Faz8 Gonderen", subject: "Faz8 konu", date: "2099-01-15" };
      },
      async listPdfAttachments() {
        throw new Error("analiz eki indirmemeli");
      },
      async getAttachment() {
        throw new Error("analiz eki indirmemeli");
      },
    };
    const first = await runGmailAnalysis(db, { gmail });
    const readAt = first.report && typeof first.report === "object" && "readAt" in first.report
      ? first.report.readAt
      : null;
    if (typeof readAt === "string") {
      noticeKeys.push(`gmail.analysis:${readAt}`);
    }
    expect(first.state).toBe("SUCCEEDED");
    expect(first.summary).not.toContain("Faz8 konu");
    expect(first.summary).toContain("Önemli 3");
    expect(metadataCalls).toBe(3);
    const second = await runGmailAnalysis(db, { gmail });
    const secondRead = second.report && typeof second.report === "object" && "readAt" in second.report
      ? second.report.readAt
      : null;
    if (typeof secondRead === "string") {
      noticeKeys.push(`gmail.analysis:${secondRead}`);
    }
    expect(second.summary).toContain("Daha önce işlenen 3");
    expect(metadataCalls).toBe(3);
    expect(await db.gmailProcessedItem.count({
      where: { gmailMessageId: { startsWith: "faz8-m" }, purpose: "ANALYSIS" },
    })).toBe(3);
  });

  it("faturayı bir kez arşivler, teklifi ve mükerreri atlar", async () => {
    const db = getPrisma();
    const gmail: GmailApi = {
      async profile() {
        return { emailAddress: ACCOUNT_EMAIL };
      },
      async listMessages(query) {
        if (query !== GMAIL_QUERIES.invoices) {
          return { messages: [] };
        }
        return {
          messages: [
            { id: "faz8-inv", threadId: "t1" },
            { id: "faz8-pro", threadId: "t2" },
            { id: "faz8-dup", threadId: "t3" },
            { id: "faz8-mail", threadId: "t4" },
          ],
        };
      },
      async getMetadata(id) {
        return { id, threadId: "t", from: "", subject: "", date: "" };
      },
      async listPdfAttachments(id) {
        if (id === "faz8-mail") {
          return { threadId: "t4", attachments: [] };
        }
        if (id === "faz8-pro") {
          return {
            threadId: "t2",
            attachments: [{ filename: "teklif.pdf", attachmentId: null, data: proformaPdf }],
          };
        }
        return {
          threadId: "t1",
          attachments: [{ filename: "fatura.pdf", attachmentId: "ek-1", data: invoicePdf }],
        };
      },
      async getAttachment() {
        throw new Error("ek verisi zaten var");
      },
    };
    const first = await importGmailInvoices(db, gmail, {
      analyze: async (bytes, fileName) => readFinanceDocument(bytes, fileName),
    });
    expect(first.imported).toEqual([
      { messageId: "faz8-inv", number: "FW-FAZ8", vendor: "Faz8 Ornek" },
    ]);
    expect(first.queued).toBe(1);
    expect(first.duplicates.map((row) => row.messageId)).toEqual(["faz8-dup"]);
    expect(first.rejected.map((row) => row.fileName)).toEqual(["teklif.pdf", ""]);
    expect(first.driveUploaded).toBe(false);
    expect(await db.invoice.count({ where: { number: "FW-FAZ8", vendor: "Faz8 Ornek" } })).toBe(0);
    expect(await db.invoiceReview.count({ where: { number: "FW-FAZ8", status: "PENDING" } })).toBe(1);
    const processed = await db.gmailProcessedItem.findUnique({
      where: {
        gmailMessageId_attachmentId_purpose: {
          gmailMessageId: "faz8-inv",
          attachmentId: "ek-1",
          purpose: "INVOICE",
        },
      },
    });
    expect(processed?.driveFileId).toBeNull();
    expect(processed?.outcome).toBe("QUEUED");

    const second = await importGmailInvoices(db, gmail, {
      analyze: async (bytes, fileName) => readFinanceDocument(bytes, fileName),
    });
    expect(second.imported).toEqual([]);
    expect(second.queued).toBe(0);
    expect(second.duplicates).toHaveLength(3);
    expect(second.driveUploaded).toBe(false);
    expect(await db.invoice.count({ where: { number: "FW-FAZ8" } })).toBe(0);
    expect(await db.invoiceReview.count({ where: { number: "FW-FAZ8" } })).toBe(1);
  });

  it("bağlantıyı kesince anahtarı siler ve iptal ister", async () => {
    const db = getPrisma();
    await db.googleAccount.update({
      where: { id: "default" },
      data: {
        status: "CONNECTED",
        refreshTokenCipher: sealSecret("refresh-faz8"),
        email: ACCOUNT_EMAIL,
      },
    });
    let revoked = false;
    const removed = await disconnectGoogle(db, async (input, init) => {
      revoked = String(input).includes("revoke") && String(init?.body ?? "").includes("token=");
      return new Response(null, { status: 200 });
    });
    expect(removed).toBe(true);
    expect(revoked).toBe(true);
    expect(await db.googleAccount.findUnique({ where: { id: "default" } })).toBeNull();
  });
});
