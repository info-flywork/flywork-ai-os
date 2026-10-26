import { renderPdfPages } from "@/server/finance/pdfPages";

export const AI_DOCUMENT_PROVIDERS = ["openai"] ;
export const DEFAULT_AI_DOCUMENT_MODEL = "gpt-4o";
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

 




















const FIELD_NAMES = ["vendor", "number", "issuedOn", "amount", "currency", "tax", "documentType"];

export function aiDocumentEnv() {
  const provider = (process.env.AI_DOCUMENT_PROVIDER ?? "").trim().toLowerCase();
  const known = AI_DOCUMENT_PROVIDERS.find((item) => item === provider) ?? null;
  const missing = [];
  if (!known) {
    missing.push("AI_DOCUMENT_PROVIDER");
  }
  if (!(process.env.AI_DOCUMENT_API_KEY ?? "").trim()) {
    missing.push("AI_DOCUMENT_API_KEY");
  }
  return { configured: missing.length === 0, provider: known, missing };
}

export function aiFailureMessage(error) {
  const message = error instanceof Error ? error.message : "Görsel analiz tamamlanamadı.";
  if (/sk-|bearer|api[_-]?key|authorization/i.test(message)) {
    return "Görsel analiz tamamlanamadı. Ayrıntı gizlendi.";
  }
  return "Görsel analiz tamamlanamadı. Alanlar tahmin edilmedi.";
}

export function aiDocumentModel() {
  const model = (process.env.AI_DOCUMENT_MODEL ?? "").trim();
  return model || DEFAULT_AI_DOCUMENT_MODEL;
}

export function openAiDocumentBody(model, pages) {
  return {
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Sayfa görsellerindeki tedarikçi, fatura numarası, tarih, tutar, para birimi, vergi ve belge türünü çıkar. Tarihi önce Fatura Tarihi, yoksa Düzenleme Tarihi, yoksa Belge Tarihi etiketinden al. Türkçe tarihler gün-ay-yıldır. issuedOn değerini YYYY-MM-DD yaz. E-posta, gönderim ve bugünün tarihi fatura tarihi değildir. Tutarı önce Ödenecek Tutar, yoksa Vergiler Dahil Toplam Tutar alanından al. Vergi, KDV toplamıdır; oran satırlarını topla ve KDV toplamı ile karşılaştır. Uyuşmazlarsa amount ve tax null ve uncertain kalsın. Türkçe 45.258,00 değerini 45258.00 yaz. Binlik ve ondalık ayracı belirsizse null ve uncertain bırak, tahmin etme. TL para birimi TRY olur. İlk görsel üst bilgi tablosu, ikinci görsel alt toplam tablosudur. Kredi kartı hesap özeti, kart ekstresi ve banka hesap özeti STATEMENT'dır. Teklif, proforma, CV ve yazışmayı fatura sayma. Fatura numarası yoksa INVOICE yazma.",
          },
          ...pages.map((page) => ({
            type: "input_image",
            image_url: `data:image/png;base64,${page.toString("base64")}`,
            detail: "high",
          })),
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "invoice_fields",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["documentType", "vendor", "number", "issuedOn", "amount", "currency", "tax", "certainty"],
          properties: {
            documentType: {
              type: "string",
              enum: ["INVOICE", "RECEIPT", "QUOTE", "PROFORMA", "CV", "CORRESPONDENCE", "STATEMENT", "UNKNOWN"],
            },
            vendor: { type: ["string", "null"] },
            number: { type: ["string", "null"] },
            issuedOn: { type: ["string", "null"] },
            amount: { type: ["string", "null"] },
            currency: { type: ["string", "null"], enum: ["TRY", "USD", "EUR", null] },
            tax: { type: ["string", "null"] },
            certainty: {
              type: "object",
              additionalProperties: false,
              required: FIELD_NAMES,
              properties: Object.fromEntries(FIELD_NAMES.map((name) => [name, { type: "string", enum: ["certain", "uncertain"] }])),
            },
          },
        },
      },
    },
  };
}

export async function requestDocumentAi(
  bytes,
  fetchImpl,
  pages,
) {
  const env = aiDocumentEnv();
  const key = (process.env.AI_DOCUMENT_API_KEY ?? "").trim();
  if (!env.configured || env.provider !== "openai" || !key) {
    throw new Error("AI belge okuyucu bağlı değil.");
  }
  const images = pages ?? (await renderPdfPages(bytes));
  if (images.length === 0) {
    throw new Error("PDF sayfaları görsele dönüştürülemedi.");
  }
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(openAiDocumentBody(aiDocumentModel(), images)),
  });
  if (!response.ok) {
    throw new Error(`Görsel analiz yanıtı başarısız (${response.status}).`);
  }
  const payload = await response.json();
  return parseAiPayload(payload);
}

export function parseAiPayload(payload) {
  const text = responseText(payload);
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Görsel analiz yanıtı okunamadı.");
  }
  const record = parsed ;
  const certaintyRecord = record.certainty;
  if (!certaintyRecord || typeof certaintyRecord !== "object") {
    throw new Error("Görsel analiz yanıtı okunamadı.");
  }
  const certainty = {} ;
  for (const name of FIELD_NAMES) {
    const value = (certaintyRecord )[name];
    certainty[name] = value === "certain" ? "certain" : "uncertain";
  }
  const documentType = documentTypeOf(record.documentType);
  return {
    documentType,
    vendor: textOrNull(record.vendor),
    number: textOrNull(record.number),
    issuedOn: textOrNull(record.issuedOn),
    amount: textOrNull(record.amount),
    currency: record.currency === "TRY" || record.currency === "USD" || record.currency === "EUR" ? record.currency : null,
    tax: textOrNull(record.tax),
    certainty,
  };
}

function responseText(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Görsel analiz yanıtı okunamadı.");
  }
  const output = "output" in payload ? payload.output : undefined;
  if (!Array.isArray(output)) {
    throw new Error("Görsel analiz yanıtı okunamadı.");
  }
  const chunks = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const part of item.content) {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  if (chunks.length === 0) {
    throw new Error("Görsel analiz yanıtı okunamadı.");
  }
  return chunks.join("");
}

function documentTypeOf(value) {
  if (
    value === "INVOICE" ||
    value === "RECEIPT" ||
    value === "QUOTE" ||
    value === "PROFORMA" ||
    value === "CV" ||
    value === "CORRESPONDENCE" ||
    value === "STATEMENT" ||
    value === "UNKNOWN"
  ) {
    return value;
  }
  return "UNKNOWN";
}

function textOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
