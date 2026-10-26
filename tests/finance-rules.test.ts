import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { summarizeCards } from "@/server/finance/cards";
import { categoryFitsScope, normalizeAccountLabel, summarizePending, summarizeSpend, vendorKey } from "@/server/finance/catalog";
import { parseMoney } from "@/server/finance/money";
import { reviewIssues, emptyDraft } from "@/server/finance/reviewRules";
import { googleConnectionReport, planDriveArchive, scanGmailInvoices } from "@/server/finance/google";
import { DEFAULT_AI_DOCUMENT_MODEL, OPENAI_RESPONSES_URL } from "@/server/finance/documentAi";
import { renderPdfPages } from "@/server/finance/pdfPages";
import { analyzeFinanceDocument, applyAiPayload, isStatement, normalizeIssuedOn, readFinanceDocument } from "@/server/finance/readDocument";
import { storeZip } from "@/server/finance/zip";
import { AppError } from "@/server/errors";

describe("harcama kuralları", () => {
  it("onaylı tutarları para birimine göre ayırır ve reddedileni toplama katmaz", () => {
    const report = summarizeSpend([
      { amount: "100.00", currency: "TRY", status: "APPROVED", vendor: "A", paymentMethod: "CARD" },
      { amount: "40.00", currency: "USD", status: "PAID", vendor: "A", paymentMethod: "TRANSFER" },
      { amount: "15.00", currency: "TRY", status: "REJECTED", vendor: "A", paymentMethod: "CASH" },
      { amount: "5.00", currency: "TRY", status: "SUBMITTED", vendor: "B", paymentMethod: "CARD" },
    ]);

    expect(normalizeAccountLabel("CARD", "4242 4242 4242 4242").value).toBe("4242");
    expect(normalizeAccountLabel("CARD", "12").error).toBeTruthy();
    expect(normalizeAccountLabel("TRANSFER", "İş hesabı").value).toBe("İş hesabı");
    expect(summarizePending([
      { amount: "10.00", currency: "EUR", status: "APPROVED", vendor: null, paymentMethod: "CASH", reimbursement: "PENDING" },
      { amount: "3.00", currency: "TRY", status: "REJECTED", vendor: null, paymentMethod: "CASH", reimbursement: "PENDING" },
    ])).toEqual([{ currency: "EUR", total: "10.00", count: 1 }]);
    expect(report.byCurrency).toEqual([
      { currency: "TRY", total: "100.00", count: 1 },
      { currency: "USD", total: "40.00", count: 1 },
    ]);
    expect(report.byVendor).toContainEqual({
      vendor: "A",
      currency: "USD",
      total: "40.00",
      count: 1,
    });
  });

  it("tedarikçi adını mükerrer kontrolü için aynı anahtara indirger", () => {
    expect(vendorKey("  Örnek   LTD ")).toBe(vendorKey("örnek ltd"));
  });

  it("ofis kartlarını Anıl Bey ve Tuna Bey olarak ayırır", () => {
    const cards = summarizeCards(
      [
        { amount: "10.00", currency: "TRY", accountLabel: "Tuna Bey kart" },
        { amount: "4.00", currency: "USD", accountLabel: "Burç Bey kart" },
      ],
      ["Anıl Bey kart", "Tuna Bey kart"],
    );
    expect(cards.map((card) => card.label)).toEqual(["Anıl Bey kart", "Tuna Bey kart"]);
    expect(cards[1]?.byCurrency).toEqual([{ currency: "TRY", total: "10.00", count: 1 }]);
    expect(cards[0]?.byCurrency).toEqual([]);
  });

  it("kart toplamını Anıl Bey ve Burç Bey kartlarında ayrı tutar", () => {
    expect(normalizeAccountLabel("CARD", "4000000000002691").value).toBe("Anıl Bey kart");
    expect(normalizeAccountLabel("CARD", "4000000000004799").value).toBe("Burç Bey kart");
    expect(normalizeAccountLabel("CARD", "4000000000004242").value).toBe("4242");
    const cards = summarizeCards([
      { amount: "10.50", currency: "TRY", accountLabel: "Anıl Bey kart" },
      { amount: "2.00", currency: "USD", accountLabel: " anıl bey kart " },
      { amount: "4.00", currency: "EUR", accountLabel: "Burç Bey kart" },
      { amount: "3.00", currency: "TRY", accountLabel: "2691" },
      { amount: "5.00", currency: "USD", accountLabel: "4000000000004799" },
      { amount: "99.00", currency: "TRY", accountLabel: "Sirket karti" },
      { amount: "1.00", currency: "TRY", accountLabel: null },
    ]);
    expect(cards).toEqual([
      {
        label: "Anıl Bey kart",
        byCurrency: [
          { currency: "TRY", total: "13.50", count: 2 },
          { currency: "USD", total: "2.00", count: 1 },
        ],
      },
      {
        label: "Burç Bey kart",
        byCurrency: [
          { currency: "USD", total: "5.00", count: 1 },
          { currency: "EUR", total: "4.00", count: 1 },
        ],
      },
    ]);
  });

  it("ofis kategorisini flywork kategorisinden ayırır", () => {
    expect(categoryFitsScope("OFFICE", "RENT")).toBe(true);
    expect(categoryFitsScope("OFFICE", "SOFTWARE")).toBe(false);
    expect(categoryFitsScope("COMPANY", "SUBSCRIPTION")).toBe(true);
  });

  it("fatura metninden alan okur ve teklifi reddeder", () => {
    const previousProvider = process.env.AI_DOCUMENT_PROVIDER;
    const previousKey = process.env.AI_DOCUMENT_API_KEY;
    delete process.env.AI_DOCUMENT_PROVIDER;
    delete process.env.AI_DOCUMENT_API_KEY;
    try {
      const invoice = Buffer.from(
        "%PDF-1.4\n(Fatura No: FW-100)\n(Tedarikci: Ornek Ltd)\n(2026-10-21)\n(150.00 TRY)\n%%EOF",
      );
      const read = readFinanceDocument(invoice, "fatura.pdf");
      expect(read.aiConfigured).toBe(false);
      expect(read.kind).toBe("INVOICE");
      expect(read.fields).toMatchObject({
        number: "FW-100",
        vendor: "Ornek Ltd",
        issuedOn: "2026-10-21",
        amount: "150.00",
        currency: "TRY",
      });
      expect(read.review.some((field) => field.name === "tax" && field.state === "missing")).toBe(true);
      expect(read.fields.tax).toBeUndefined();

      const proforma = Buffer.from("%PDF-1.4\n(Proforma teklif)\n%%EOF");
      expect(readFinanceDocument(proforma, "teklif.pdf").kind).toBe("NOT_INVOICE");
      const unpaidNotice = Buffer.from("%PDF-1.4\n(E-Fatura)\n(Fatura No: GH-1)\n(Faturaniz odenmedi)\n(Tedarikci: Ornek Ltd)\n(2026-10-22)\n(5104.40 TRY)\n%%EOF");
      expect(readFinanceDocument(unpaidNotice, "Fatura-1.pdf").kind).toBe("NOT_INVOICE");
      expect(readFinanceDocument(Buffer.from("%PDF-1.4\n%%EOF"), "cv.pdf").kind).toBe("NOT_INVOICE");
    } finally {
      restoreEnv("AI_DOCUMENT_PROVIDER", previousProvider);
      restoreEnv("AI_DOCUMENT_API_KEY", previousKey);
    }
  });

  it("faturayı ekstre sanmaz, hesap özetini fatura kuyruğuna koymaz", () => {
    const invoice = Buffer.from(
      "%PDF-1.4\n(Fatura No: FW-100)\n(Tedarikci: Ornek Ltd)\n(Fatura Tarihi: 01.09.2026)\n(Odeme araci: kredi karti)\n(Odenecek Tutar: 150.00 TRY)\n%%EOF",
    );
    const read = readFinanceDocument(invoice, "kart-odeme.pdf");
    expect(read.kind).toBe("INVOICE");
    expect(read.fields.number).toBe("FW-100");
    expect(isStatement("Odeme araci kredi karti. Fatura No FW-100")).toBe(false);
    const statement = Buffer.from(
      "%PDF-1.4\n(Sirket Kredi Karti Hesap Ozeti)\n(Kart Numarasi)\n(Hesap Ozeti Borcu)\n(Hesap Kesim Tarihi)\n(Son Odeme Tarihi)\n%%EOF",
    );
    expect(readFinanceDocument(statement, "belge.pdf").kind).toBe("STATEMENT");
    const receipt = Buffer.from(
      "%PDF-1.4\n(Receipt)\n(Makbuz No: R-10)\n(Satici: Ornek Kasa)\n(Toplam odeme 25.00 USD)\n(Nakit tahsilat belgesi)\n%%EOF",
    );
    expect(readFinanceDocument(receipt, "fis.pdf").kind).toBe("RECEIPT");
  });

  it("Türkçe fatura tarihini gün-ay-yıl olarak kaydeder", () => {
    expect(normalizeIssuedOn("01-09-2026")).toBe("2026-09-01");
    expect(normalizeIssuedOn("01.09.2026")).toBe("2026-09-01");
    expect(normalizeIssuedOn("01/09/2026")).toBe("2026-09-01");
    expect(normalizeIssuedOn("September 10, 2026")).toBe("2026-09-10");
    expect(normalizeIssuedOn("31-04-2026")).toBeUndefined();
    const invoice = Buffer.from(
      "%PDF-1.4\n(Fatura No: MEA2026000003621)\n(Tedarikci: Meal Box)\n(Vade Tarihi: 15-10-2026)\n(Fatura Tarihi: 01-09-2026)\n%%EOF",
    );
    const read = readFinanceDocument(invoice, "MEA2026000003621.pdf");
    expect(read.fields.issuedOn).toBe("2026-09-01");
    expect(normalizeIssuedOn("12102026")).toBe("2026-10-12");
    const eInvoice = Buffer.from(
      "%PDF-1.4\n(SAYIN FLY WORK VENTURES YAZILIM ANONIM SIRKETI)\n(Fatura No: AKF2026000000148)\n(Fatura Tarihi: 12102026)\n(AKF GRUP GIDA TICARET LIMITED SIRKETI)\n(Yemek Bedeli 1 Adet 6.295,09 TL)\n(Hesaplanan KDV %10 629,51 TL)\n(Odenecek Tutar 6.924,60 TL)\n%%EOF",
    );
    const meal = readFinanceDocument(eInvoice, "AKF2026000000148.pdf");
    expect(meal.fields.number).toBe("AKF2026000000148");
    expect(meal.fields.issuedOn).toBe("2026-10-12");
    expect(meal.fields.vendor).toBe("AKF GRUP GIDA TICARET LIMITED SIRKETI");
    expect(meal.fields.amount).toBe("6924.60");
    expect(meal.fields.tax).toBe("629.51");
    const dueOnly = Buffer.from("%PDF-1.4\n(Fatura No: MEA1)\n(Tedarikci: Meal Box)\n(Vade Tarihi: 15-10-2026)\n%%EOF");
    expect(readFinanceDocument(dueOnly, "fatura.pdf").fields.issuedOn).toBeUndefined();
  });

  it("modelin gün-ay-yıl tarihini boşaltmaz, belirsiz tarihi de doldurmaz", () => {
    const base = readFinanceDocument(Buffer.from("%PDF-1.4\n%%EOF"), "fatura.pdf");
    const certain = applyAiPayload(base, {
      documentType: "INVOICE",
      vendor: "Meal Box",
      number: "MEA2026000003621",
      issuedOn: "01-09-2026",
      amount: "10.00",
      currency: "TRY",
      tax: null,
      certainty: {
        documentType: "certain",
        vendor: "certain",
        number: "certain",
        issuedOn: "certain",
        amount: "certain",
        currency: "certain",
        tax: "uncertain",
      },
    });
    expect(certain.fields.issuedOn).toBe("2026-09-01");
    const uncertain = applyAiPayload(base, {
      ...certain.fields,
      documentType: "INVOICE",
      vendor: "Meal Box",
      number: "MEA2026000003621",
      issuedOn: "01-09-2026",
      amount: "10.00",
      currency: "TRY",
      tax: null,
      certainty: {
        documentType: "certain",
        vendor: "certain",
        number: "certain",
        issuedOn: "uncertain",
        amount: "certain",
        currency: "certain",
        tax: "uncertain",
      },
    });
    expect(uncertain.fields.issuedOn).toBeUndefined();
    expect(uncertain.review.some((field) => field.name === "issuedOn" && field.state === "uncertain")).toBe(true);
  });

  it("Türkçe ve İngilizce tutarları ayırır, belirsiz binliği tahmin etmez", () => {
    expect(parseMoney("45.258,00")?.value).toBe("45258.00");
    expect(parseMoney("3.378,00")?.value).toBe("3378.00");
    expect(parseMoney("3.198,00")?.value).toBe("3198.00");
    expect(parseMoney("180,00")?.value).toBe("180.00");
    expect(parseMoney("1,234.56")?.value).toBe("1234.56");
    expect(parseMoney("25.00")?.value).toBe("25.00");
    expect(parseMoney("45.258")?.state).toBe("uncertain");
    expect(parseMoney("45.258")?.value).toBeUndefined();
    const invoice = Buffer.from(
      "%PDF-1.4\n(Fatura No: MEA2026000003621)\n(Tedarikci: Meal Box)\n(Fatura Tarihi: 01.09.2026)\n(KDV (%10): 3.198,00 TL)\n(KDV (%20): 180,00 TL)\n(KDV Toplami: 3.378,00 TL)\n(Vergiler Dahil Toplam Tutar: 45.258,00 TL)\n(Odenecek Tutar: 45.258,00 TL)\n%%EOF",
    );
    const read = readFinanceDocument(invoice, "MEA2026000003621.pdf");
    expect(read.fields.amount).toBe("45258.00");
    expect(read.fields.currency).toBe("TRY");
    expect(read.fields.tax).toBe("3378.00");
    expect(read.fields.issuedOn).toBe("2026-09-01");
    const ai = applyAiPayload(read, {
      documentType: "INVOICE",
      vendor: "Meal Box",
      number: "MEA2026000003621",
      issuedOn: "2026-09-01",
      amount: "45.258",
      currency: "TRY",
      tax: "3.198",
      certainty: {
        documentType: "certain",
        vendor: "certain",
        number: "certain",
        issuedOn: "certain",
        amount: "certain",
        currency: "certain",
        tax: "certain",
      },
    });
    expect(ai.fields.amount).toBe("45258.00");
    expect(ai.fields.tax).toBe("3378.00");
    const ambiguous = applyAiPayload(readFinanceDocument(Buffer.from("%PDF-1.4\n%%EOF"), "fatura.pdf"), {
      documentType: "INVOICE",
      vendor: "Meal Box",
      number: "MEA2026000003621",
      issuedOn: "2026-09-01",
      amount: "45.258",
      currency: "TRY",
      tax: "3.198",
      certainty: {
        documentType: "certain",
        vendor: "certain",
        number: "certain",
        issuedOn: "certain",
        amount: "certain",
        currency: "certain",
        tax: "certain",
      },
    });
    expect(ambiguous.fields.amount).toBeUndefined();
    expect(ambiguous.fields.tax).toBeUndefined();
    expect(ambiguous.review.some((field) => field.name === "amount" && field.state === "uncertain")).toBe(true);
    const conflict = emptyDraft();
    conflict.vendor = "Meal Box";
    conflict.number = "MEA1";
    conflict.issuedOn = "2026-09-01";
    conflict.amount = "10.00";
    conflict.tax = "12.00";
    conflict.currency = "TRY";
    conflict.documentType = "INVOICE";
    expect(reviewIssues(conflict)).toContain("Tutar ve vergi tutarsız");
  });

  it("sıkıştırılmış fatura metnini okur ve etiketsiz tutarı doldurmaz", () => {
    const stream = "BT (Fatura No: FW-200) Tj (Tedarikci: Akis Ltd) Tj (Genel toplam: 80.50 TRY) Tj (KDV: 15.00) Tj ET";
    const compressed = deflateSync(Buffer.from(stream));
    const pdf = Buffer.concat([
      Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
      compressed,
      Buffer.from("\nendstream\nendobj\n%%EOF"),
    ]);
    const read = readFinanceDocument(pdf, "fatura.pdf");
    expect(read.kind).toBe("INVOICE");
    expect(read.fields).toMatchObject({
      number: "FW-200",
      vendor: "Akis Ltd",
      amount: "80.50",
      currency: "TRY",
      tax: "15.00",
    });
    expect(read.review.some((field) => field.name === "issuedOn")).toBe(true);

    const ambiguous = Buffer.from("%PDF-1.4\n(Fatura No: FW-201)\n(Tedarikci: Akis Ltd)\n(10.00 TRY)\n(12.00 USD)\n%%EOF");
    const loose = readFinanceDocument(ambiguous, "fatura.pdf");
    expect(loose.fields.amount).toBeUndefined();
    expect(loose.review.some((field) => field.name === "amount" && field.state === "uncertain")).toBe(true);
  });

  it("anahtar yokken görsel analiz çağırmaz", async () => {
    const previousProvider = process.env.AI_DOCUMENT_PROVIDER;
    const previousKey = process.env.AI_DOCUMENT_API_KEY;
    delete process.env.AI_DOCUMENT_PROVIDER;
    delete process.env.AI_DOCUMENT_API_KEY;
    const fetchImpl = vi.fn<typeof fetch>();
    try {
      const read = await analyzeFinanceDocument(Buffer.from("%PDF-1.4\n%%EOF"), "belge.pdf", { fetchImpl });
      expect(read.aiState).toBe("WAITING_CONNECTION");
      expect(read.kind).toBe("UNKNOWN");
      expect(read.fields.vendor).toBeUndefined();
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      restoreEnv("AI_DOCUMENT_PROVIDER", previousProvider);
      restoreEnv("AI_DOCUMENT_API_KEY", previousKey);
    }
  });

  it("geçersiz PDF için OpenAI çağırmaz ve alan uydurmaz", async () => {
    const previousProvider = process.env.AI_DOCUMENT_PROVIDER;
    const previousKey = process.env.AI_DOCUMENT_API_KEY;
    process.env.AI_DOCUMENT_PROVIDER = "openai";
    process.env.AI_DOCUMENT_API_KEY = "test-key";
    const fetchImpl = vi.fn<typeof fetch>();
    try {
      const read = await analyzeFinanceDocument(Buffer.from("%PDF-1.4\n%%EOF"), "belge.pdf", { fetchImpl });
      expect(read.aiState).toBe("FAILED");
      expect(read.fields.vendor).toBeUndefined();
      expect(read.fields.amount).toBeUndefined();
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      restoreEnv("AI_DOCUMENT_PROVIDER", previousProvider);
      restoreEnv("AI_DOCUMENT_API_KEY", previousKey);
    }
  });

  it("PDF sayfasını PNG görsele çevirir", async () => {
    const pages = await renderPdfPages(minimalPdf("BT /F1 24 Tf 40 200 Td (Fatura) Tj ET"));
    expect(pages.length).toBe(1);
    expect(pages[0].subarray(0, 4).toString("hex")).toBe("89504e47");
  });

  it("belirsiz AI alanını ve teklifi kayda çevirmez", async () => {
    const previousProvider = process.env.AI_DOCUMENT_PROVIDER;
    const previousKey = process.env.AI_DOCUMENT_API_KEY;
    const previousModel = process.env.AI_DOCUMENT_MODEL;
    process.env.AI_DOCUMENT_PROVIDER = "openai";
    process.env.AI_DOCUMENT_API_KEY = "test-key";
    process.env.AI_DOCUMENT_MODEL = DEFAULT_AI_DOCUMENT_MODEL;
    try {
      const uncertain = await analyzeFinanceDocument(Buffer.from("%PDF-1.4\n%%EOF"), "belge.pdf", {
        pages: [TINY_PNG],
        fetchImpl: aiFetch({
          documentType: "INVOICE",
          vendor: "Tahmin Ltd",
          number: null,
          issuedOn: null,
          amount: null,
          currency: null,
          tax: null,
          certainty: {
            documentType: "certain",
            vendor: "uncertain",
            number: "missing",
            issuedOn: "uncertain",
            amount: "uncertain",
            currency: "uncertain",
            tax: "uncertain",
          },
        }),
      });
      expect(uncertain.aiState).toBe("READ");
      expect(uncertain.kind).toBe("INVOICE");
      expect(uncertain.fields.vendor).toBeUndefined();
      expect(uncertain.review.some((field) => field.name === "vendor" && field.state === "uncertain")).toBe(true);

      const quote = await analyzeFinanceDocument(Buffer.from("%PDF-1.4\n%%EOF"), "belge.pdf", {
        pages: [TINY_PNG],
        fetchImpl: aiFetch({
          documentType: "QUOTE",
          vendor: "Teklif Ltd",
          number: "T-1",
          issuedOn: "2026-10-21",
          amount: "10.00",
          currency: "TRY",
          tax: "1.00",
          certainty: {
            documentType: "certain",
            vendor: "certain",
            number: "certain",
            issuedOn: "certain",
            amount: "certain",
            currency: "certain",
            tax: "certain",
          },
        }),
      });
      expect(quote.kind).toBe("NOT_INVOICE");
      expect(quote.fields.vendor).toBeUndefined();
    } finally {
      restoreEnv("AI_DOCUMENT_PROVIDER", previousProvider);
      restoreEnv("AI_DOCUMENT_API_KEY", previousKey);
      restoreEnv("AI_DOCUMENT_MODEL", previousModel);
    }
  });

  it("google bağlantısını çalışıyor göstermez", () => {
    const report = googleConnectionReport();
    expect(report.connected).toBe(false);
    expect(report.oauthImplemented).toBe(true);
    expect(report.redirectPath).toBe("/api/google/oauth/callback");
    for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]) {
      if (!process.env[name]) {
        expect(report.missing).toContain(name);
      }
    }
    expect(planDriveArchive({ issuedOn: "2026-10-21", vendor: "Örnek Ltd", number: "FW/100" })).toEqual({
      folder: "Flywork/Faturalar/2026/10",
      fileName: "rnek-ltd-FW-100.pdf",
    });
    expect(() => scanGmailInvoices()).toThrow(AppError);
  });

  it("muhasebe paketini zip olarak kurar", () => {
    const zip = storeZip([{ name: "Flywork/Faturalar/2026/10/paket.csv", bytes: Buffer.from("no") }]);
    expect(zip.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(zip.includes(Buffer.from("paket.csv"))).toBe(true);
  });
});

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function minimalPdf(stream: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

function restoreEnv(name: "AI_DOCUMENT_PROVIDER" | "AI_DOCUMENT_API_KEY" | "AI_DOCUMENT_MODEL", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function aiFetch(body: unknown): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe(OPENAI_RESPONSES_URL);
    const parsed = JSON.parse(String(init?.body)) as {
      model: string;
      input: { content: { type: string; image_url?: string }[] }[];
      text: { format: { strict: boolean; schema: { additionalProperties: boolean; required: string[] } } };
    };
    expect(parsed.model).toBe(DEFAULT_AI_DOCUMENT_MODEL);
    const content = parsed.input[0]?.content ?? [];
    expect(content.some((part) => part.type === "input_file")).toBe(false);
    const images = content.filter((part) => part.type === "input_image");
    expect(images).toHaveLength(1);
    expect(images[0]?.image_url?.startsWith("data:image/png;base64,")).toBe(true);
    expect(parsed.text.format.strict).toBe(true);
    expect(parsed.text.format.schema.additionalProperties).toBe(false);
    expect(parsed.text.format.schema.required).toEqual([
      "documentType",
      "vendor",
      "number",
      "issuedOn",
      "amount",
      "currency",
      "tax",
      "certainty",
    ]);
    expect(JSON.stringify(parsed).includes("test-key")).toBe(false);
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    expect(authorization.startsWith("Bearer ")).toBe(true);
    return new Response(
      JSON.stringify({ output: [{ content: [{ text: JSON.stringify(body) }] }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}
