import { aiDocumentEnv, aiFailureMessage, requestDocumentAi } from "@/server/finance/documentAi";
import { parseMoney } from "@/server/finance/money";
import { documentHash, extractPdfText, extractPdfTextSync } from "@/server/finance/pdfText";

 

































const WAITING = "Bağlantı bekleniyor. OCR ve görsel analiz için AI sağlayıcısı tanımlı değil. Eksik alanlar tahmin edilmedi.";

export function readFinanceDocument(bytes, fileName) {
  return interpretFinanceText(extractPdfTextSync(bytes), bytes, fileName, "NOT_NEEDED");
}

export async function analyzeFinanceDocument(
  bytes,
  fileName,
  options,
) {
  const extracted = await extractPdfText(bytes);
  const base = interpretFinanceText(extracted, bytes, fileName, "NOT_NEEDED");
  if (base.kind === "NOT_INVOICE" || base.kind === "STATEMENT" || (base.textLayer === "READABLE" && !options?.useVision)) {
    return base;
  }
  const env = aiDocumentEnv();
  if (!env.configured) {
    return {
      ...base,
      aiConfigured: false,
      aiState: "WAITING_CONNECTION",
      warnings: [WAITING, ...base.warnings.filter((warning) => !warning.startsWith("Bağlantı bekleniyor"))],
    };
  }
  try {
    const ai = await requestDocumentAi(bytes, options?.fetchImpl ?? fetch, options?.pages);
    return applyAiPayload(base, ai);
  } catch (error) {
    return {
      ...base,
      aiConfigured: true,
      aiState: "FAILED",
      warnings: [aiFailureMessage(error)],
    };
  }
}

export function interpretFinanceText(
  extracted,
  bytes,
  fileName,
  aiState,
) {
  const env = aiDocumentEnv();
  const hash = documentHash(bytes);
  const empty = emptyResult(extracted, hash, env.configured, aiState);
  if (isStatement(extracted.text)) {
    return {
      ...empty,
      kind: "STATEMENT",
      aiState: "NOT_NEEDED",
      fields: { documentType: "STATEMENT" },
      review: [],
      warnings: ["Kredi kartı ekstresi veya banka hesap özeti fatura kuyruğuna alınmaz."],
    };
  }
  if (extracted.layer === "READABLE" && unpaidNotice(extracted.text)) {
    return {
      ...empty,
      kind: "NOT_INVOICE",
      aiState: "NOT_NEEDED",
      fields: { documentType: "NOT_INVOICE" },
      review: [],
      warnings: ["Ödenmemiş bildirim fatura olarak kaydedilmez. Bu yalnızca ön bilgilendirmedir."],
    };
  }
  if (fileBlocked(fileName) || (extracted.layer === "READABLE" && contentBlocked(extracted.text) && !invoiceWord(extracted.text))) {
    return {
      ...empty,
      kind: "NOT_INVOICE",
      aiState: "NOT_NEEDED",
      fields: { documentType: "NOT_INVOICE" },
      review: [],
      warnings: ["Yazışma, teklif, proforma ve CV fatura olarak kaydedilmez."],
    };
  }
  if (extracted.encrypted) {
    return {
      ...empty,
      warnings: ["PDF şifreli. Metin okunamadı ve alanlar tahmin edilmedi."],
    };
  }
  if (extracted.layer !== "READABLE") {
    const reason = extracted.layer === "EMPTY"
      ? "Metin katmanı yok. Görsel analiz gerekiyor."
      : "Metin katmanı çözülemedi. Görsel analiz gerekiyor.";
    return {
      ...empty,
      review: allMissing(),
      warnings: [reason],
    };
  }

  const text = extracted.text;
  const fields = {};
  const review = [];
  const vendor = labeled(text, /(?:tedarik[cç]i|sat[ıi]c[ıi]|[üu]nvan)\s*[:\-]\s*([^\n\r]{2,80})/i) ?? sellerFromParties(text);
  keep("vendor", vendor, fields, review);
  const number = labeled(text, /(?:fatura|invoice)\s*(?:no|numaras[ıi]|number)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{1,40})/i);
  keep("number", number, fields, review);
  const issued = dateField(text);
  place("issuedOn", issued, fields, review);
  const moneyField = amountField(text);
  place("amount", { state: moneyField.state, value: moneyField.amount }, fields, review);
  place("currency", { state: moneyField.state, value: moneyField.currency }, fields, review);
  const tax = taxField(text);
  place("tax", tax, fields, review);

  const quote = /proforma|teklifname|fiyat teklifi|\bteklif\b/i.test(text);
  const invoice = invoiceWord(text);
  const receipt = receiptWord(text);
  let documentType = "UNKNOWN";
  let typeState = "missing";
  if (quote && invoice) {
    typeState = "uncertain";
  } else if (quote || contentBlocked(text)) {
    documentType = "NOT_INVOICE";
    typeState = "certain";
  } else if (invoice && number) {
    documentType = "INVOICE";
    typeState = "certain";
  } else if (receipt && !invoice) {
    documentType = "RECEIPT";
    typeState = "certain";
  } else if (invoice || receipt) {
    typeState = "uncertain";
  }
  if (typeState === "certain") {
    fields.documentType = documentType;
  } else {
    review.push({ name: "documentType", state: typeState });
  }

  const kind = documentType === "INVOICE" || documentType === "RECEIPT" || documentType === "NOT_INVOICE"
    ? documentType
    : "UNKNOWN";
  const warnings = review.length > 0
    ? ["Belirsiz veya eksik alanlar tahmin edilmedi. Yönetici incelemesi gerekir."]
    : ["Metin katmanı okundu."];
  return {
    kind,
    aiConfigured: env.configured,
    aiState,
    textLayer: extracted.layer,
    engine: extracted.engine,
    pdfjs: extracted.pdfjs,
    images: extracted.images,
    contentStreams: extracted.contentStreams,
    contentHash: hash,
    fields,
    review,
    warnings,
  };
}

export function applyAiPayload(base, ai) {
  if (ai.certainty.documentType !== "certain") {
    return { ...base, aiConfigured: true, aiState: "READ", warnings: ["Belge türü belirsiz. Kayıt oluşturulmadı ve alanlar tahmin edilmedi."] };
  }
  if (ai.documentType === "STATEMENT") {
    if (base.kind === "INVOICE" || base.kind === "RECEIPT") {
      return { ...base, aiConfigured: true, aiState: "READ" };
    }
    return {
      ...base,
      kind: "STATEMENT",
      aiConfigured: true,
      aiState: "READ",
      fields: { documentType: "STATEMENT" },
      review: [],
      warnings: ["Kredi kartı ekstresi veya banka hesap özeti fatura kuyruğuna alınmaz."],
    };
  }
  if (base.kind === "STATEMENT") {
    return { ...base, aiConfigured: true, aiState: "READ" };
  }
  if (ai.documentType === "QUOTE" || ai.documentType === "PROFORMA" || ai.documentType === "CV" || ai.documentType === "CORRESPONDENCE") {
    return {
      ...base,
      kind: "NOT_INVOICE",
      aiConfigured: true,
      aiState: "READ",
      fields: { documentType: "NOT_INVOICE" },
      review: [],
      warnings: ["Yazışma, teklif, proforma ve CV fatura olarak kaydedilmez."],
    };
  }
  const fields = {};
  const review = [];
  const kind = ai.documentType === "INVOICE" || ai.documentType === "RECEIPT" ? ai.documentType : "UNKNOWN";
  fields.documentType = kind;
  copyCertain("vendor", ai.vendor, ai.certainty.vendor, fields, review);
  copyCertain("number", ai.number, ai.certainty.number, fields, review);
  copyCertain("issuedOn", normalizeIssuedOn(ai.issuedOn), ai.certainty.issuedOn, fields, review);
  if (!fields.issuedOn && base.fields.issuedOn) {
    fields.issuedOn = base.fields.issuedOn;
    const index = review.findIndex((field) => field.name === "issuedOn");
    if (index >= 0) {
      review.splice(index, 1);
    }
  }
  copyMoney("amount", ai.amount, ai.certainty.amount, fields, review);
  copyCertain("currency", ai.currency ?? undefined, ai.certainty.currency, fields, review);
  copyMoney("tax", ai.tax, ai.certainty.tax, fields, review);
  preferTextMoney("amount", base.fields.amount, fields, review);
  preferTextMoney("tax", base.fields.tax, fields, review);
  if (fields.amount && fields.tax && Number(fields.tax) > Number(fields.amount) + 0.001) {
    delete fields.amount;
    delete fields.tax;
    replaceReview(review, "amount", "uncertain");
    replaceReview(review, "tax", "uncertain");
  }
  return {
    ...base,
    kind,
    aiConfigured: true,
    aiState: "READ",
    fields,
    review,
    warnings: review.length > 0
      ? ["Görsel analiz tamamlandı. Belirsiz alanlar doldurulmadı. Yönetici incelemesi gerekir."]
      : ["Görsel analiz tamamlandı."],
  };
}






export function documentIntelligence() {
  const env = aiDocumentEnv();
  return {
    configured: env.configured,
    read(input) {
      return readFinanceDocument(input.bytes, input.fileName);
    },
  };
}

function emptyResult(
  extracted,
  hash,
  aiConfigured,
  aiState,
) {
  return {
    kind: "UNKNOWN",
    aiConfigured,
    aiState,
    textLayer: extracted.layer,
    engine: extracted.engine,
    pdfjs: extracted.pdfjs,
    images: extracted.images,
    contentStreams: extracted.contentStreams,
    contentHash: hash,
    fields: {},
    review: allMissing(),
    warnings: [],
  };
}

function allMissing() {
  return [
    { name: "vendor", state: "missing" },
    { name: "number", state: "missing" },
    { name: "issuedOn", state: "missing" },
    { name: "amount", state: "missing" },
    { name: "currency", state: "missing" },
    { name: "tax", state: "missing" },
    { name: "documentType", state: "missing" },
  ];
}

function place(
  name,
  outcome,
  fields,
  review,
) {
  if (outcome.state === "certain" && outcome.value) {
    keep(name, outcome.value, fields, review);
    return;
  }
  review.push({ name, state: outcome.state === "uncertain" ? "uncertain" : "missing" });
}

function keep(
  name,
  value,
  fields,
  review,
) {
  if (!value) {
    review.push({ name, state: "missing" });
    return;
  }
  if (name === "currency" && value !== "TRY" && value !== "USD" && value !== "EUR") {
    review.push({ name, state: "uncertain" });
    return;
  }
  Object.assign(fields, { [name]: value });
}

function copyCertain(
  name,
  value,
  certainty,
  fields,
  review,
) {
  if (certainty !== "certain" || !value) {
    review.push({ name, state: certainty === "uncertain" ? "uncertain" : "missing" });
    return;
  }
  keep(name, value, fields, review);
}

function unpaidNotice(text) {
  return /faturan[ıi]z\s+[öo]denmedi/i.test(text);
}

function fileBlocked(fileName) {
  const lowered = fileName.toLocaleLowerCase("tr");
  if (/(^|[^a-z])cv([^a-z]|$)/i.test(fileName)) {
    return true;
  }
  return ["özgeçmiş", "ozgecmis", "curriculum vitae", "proforma", "teklif"].some((term) => lowered.includes(term));
}

function contentBlocked(text) {
  const lowered = text.toLocaleLowerCase("tr");
  return ["özgeçmiş", "ozgecmis", "curriculum vitae", "proforma", "teklifname", "fiyat teklifi", "yazışma", "yazisma"].some((term) =>
    lowered.includes(term),
  );
}

export function isStatement(text) {
  const lowered = text.toLocaleLowerCase("tr");
  return [
    /kredi\s*kart[ıi]\s*hesap\s*[öo]zeti/,
    /[şs]irket\s*kredi\s*kart[ıi]/,
    /kart\s*ekstresi/,
    /kredi\s*kart[ıi]\s*ekstresi/,
    /banka\s*hesap\s*[öo]zeti/,
    /hesap\s*hareketleri/,
    /hesap\s*[öo]zeti\s*borcu/,
    /credit\s*card\s*statement/,
    /card\s*statement/,
    /bank\s*statement/,
    /account\s*statement/,
  ].some((pattern) => pattern.test(lowered));
}

function invoiceWord(text) {
  return /fatura|invoice/i.test(text);
}

function receiptWord(text) {
  return /(^|[^a-z0-9çğıöşü])fi[sş]([^a-z0-9çğıöşü]|$)|makbuz|receipt/i.test(text.toLocaleLowerCase("tr"));
}

function sellerFromParties(text) {
  const found = [];
  const pattern = /([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ0-9 .&'’-]*?(?:L[İI]M[İI]TED\s+[SŞ][İI]RKET[İI]|ANON[İI]M\s+[SŞ][İI]RKET[İI]))/giu;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const prefix = text.slice(Math.max(0, start - 12), start);
    const name = match[1].replace(/\s+/g, " ").trim();
    if (/^say[ıi]n\b/i.test(name) || /say[ıi]n\s*$/i.test(prefix)) {
      continue;
    }
    if (name.length >= 2 && !found.includes(name)) {
      found.push(name);
    }
  }
  return found.length === 1 ? found[0] : undefined;
}

function calculatedTax(text) {
  const matches = [...text.matchAll(new RegExp(String.raw`hesaplanan\s*kdv(?:\s*\([^)]*\))?(?:\s*%\s*\d{1,2}(?:[.,]\d+)?)?\s*[:\-]?\s*(${MONEY_TOKEN})`, "gi"))]
    .map((match) => parseMoney(match[1]))
    .flatMap((parsed) => parsed.state === "certain" && parsed.value ? [parsed.value] : []);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : undefined;
}

function labeled(text, pattern) {
  return text.match(pattern)?.[1]?.replace(/\s+/g, " ").trim();
}

const DATE_TOKEN = String.raw`\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}`;
const LABELED_DATE_TOKEN = String.raw`${DATE_TOKEN}|\d{8}`;
const DATE_LABELS = [/fatura\s*tarihi/i, /d[üu]zenleme\s*tarihi/i, /belge\s*tarihi/i];

function dateField(text) {
  const source = text.toLocaleLowerCase("tr");
  for (const label of DATE_LABELS) {
    const match = source.match(new RegExp(String.raw`${label.source}\s*[:\-]?\s*(${LABELED_DATE_TOKEN})`, "i"));
    const issuedOn = normalizeIssuedOn(match?.[1]);
    if (issuedOn) {
      return { state: "certain", value: issuedOn };
    }
  }
  const dates = [...source.matchAll(new RegExp(DATE_TOKEN, "g"))]
    .flatMap((match) => {
      const start = match.index ?? 0;
      const prefix = source.slice(Math.max(0, start - 48), start);
      if (/(?:vade|e-?posta|g[öo]nderim|yazd[ıi]rma|tarama|son\s*[öo]deme)\s*tarihi\s*[:\-]?\s*$/i.test(prefix)) {
        return [];
      }
      const issuedOn = normalizeIssuedOn(match[0]);
      return issuedOn ? [issuedOn] : [];
    });
  const unique = [...new Set(dates)];
  if (unique.length === 1) {
    return { state: "certain", value: unique[0] };
  }
  return { state: unique.length > 1 ? "uncertain" : "missing" };
}

const MONEY_TOKEN = String.raw`\d{1,3}(?:[.\s]\d{3})+(?:,\d{2})?|\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:[.,]\d{2})?`;
const PAYABLE_LABELS = [
  /[öo]denecek\s*tutar/i,
  /vergiler\s*dahil\s*toplam(?:\s*tutar)?/i,
];
const TOTAL_LABELS = [/genel\s*toplam/i, /toplam\s*tutar/i];

function amountField(text) {
  const payable = labeledMoney(text, PAYABLE_LABELS[0]);
  const included = labeledMoney(text, PAYABLE_LABELS[1]);
  if (payable && included && payable.value !== included.value) {
    return { state: "uncertain" };
  }
  const chosen = payable ?? included ?? labeledMoney(text, TOTAL_LABELS[0]) ?? labeledMoney(text, TOTAL_LABELS[1]);
  if (chosen) {
    return chosen.state === "certain"
      ? { state: "certain", amount: chosen.value, currency: chosen.currency }
      : { state: "uncertain" };
  }
  const pairs = [...text.matchAll(new RegExp(String.raw`(?:^|\n)\s*(${MONEY_TOKEN})\s*(USD|EUR|TRY|TL)\b`, "gi"))];
  if (pairs.length === 1) {
    const parsed = parseMoney(pairs[0][1]);
    return parsed.state === "certain" && parsed.value
      ? { state: "certain", amount: parsed.value, currency: currencyOf(pairs[0][2]) }
      : { state: parsed.state === "uncertain" ? "uncertain" : "missing" };
  }
  return { state: pairs.length > 1 ? "uncertain" : "missing" };
}

function taxField(text) {
  const calculated = calculatedTax(text);
  if (calculated) {
    return { state: "certain", value: calculated };
  }
  const total = labeledMoney(text, /(?:kdv\s*toplam[ıi]|toplam\s*kdv|hesaplanan\s*kdv\s*toplam[ıi]|vergiler\s*toplam[ıi])/i);
  const lines = [...text.matchAll(new RegExp(String.raw`%\s*\d{1,2}(?:[.,]\d+)?(?:\s*kdv)?[^%\n]{0,30}?(${MONEY_TOKEN})`, "gi"))]
    .map((match) => parseMoney(match[1]))
    .filter((parsed) => parsed.state === "certain" && parsed.value);
  const lineSum = lines.length > 0
    ? lines.reduce((sum, parsed) => sum + Number(parsed.value), 0).toFixed(2)
    : undefined;
  if (total?.state === "uncertain") {
    return { state: "uncertain" };
  }
  if (total?.value && lineSum && Math.abs(Number(total.value) - Number(lineSum)) > 0.001) {
    return { state: "uncertain" };
  }
  if (total?.value) {
    return { state: "certain", value: total.value };
  }
  if (lineSum) {
    return { state: "certain", value: lineSum };
  }
  const generic = labeledMoney(text, /(?:kdv|vergi|vat|tax)(?:\s*tutar[ıi])?/i);
  if (!generic) {
    return { state: "missing" };
  }
  return generic.state === "certain" ? { state: "certain", value: generic.value } : { state: "uncertain" };
}

function labeledMoney(
  text,
  label,
) {
  const match = text.match(new RegExp(String.raw`${label.source}\s*[:\-]?\s*(${MONEY_TOKEN})(?:\s*(USD|EUR|TRY|TL))?`, "i"));
  if (!match) {
    return undefined;
  }
  const parsed = parseMoney(match[1]);
  if (parsed.state === "certain" && parsed.value) {
    return { state: "certain", value: parsed.value, currency: currencyOf(match[2]) };
  }
  return { state: "uncertain" };
}

function currencyOf(value) {
  const currency = value?.toUpperCase() === "TL" ? "TRY" : value?.toUpperCase();
  return currency === "TRY" || currency === "USD" || currency === "EUR" ? currency : undefined;
}

function copyMoney(
  name,
  value,
  certainty,
  fields,
  review,
) {
  const parsed = parseMoney(value);
  if (certainty !== "certain" || parsed.state !== "certain" || !parsed.value) {
    review.push({
      name,
      state: certainty === "uncertain" || parsed.state === "uncertain" ? "uncertain" : "missing",
    });
    return;
  }
  keep(name, parsed.value, fields, review);
}

function preferTextMoney(
  name,
  textValue,
  fields,
  review,
) {
  if (!textValue) {
    return;
  }
  fields[name] = textValue;
  const index = review.findIndex((field) => field.name === name);
  if (index >= 0) {
    review.splice(index, 1);
  }
}

function replaceReview(review, name, state) {
  const index = review.findIndex((field) => field.name === name);
  if (index >= 0) {
    review[index] = { name, state };
    return;
  }
  review.push({ name, state });
}

const ENGLISH_MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

export function normalizeIssuedOn(value) {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  const compact = trimmed.replace(/\s+/g, "");
  const iso = compact.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const local = compact.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const packed = compact.match(/^(\d{2})(\d{2})(\d{4})$/);
  const english = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  const englishDayFirst = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  const year = Number(iso?.[1] ?? local?.[3] ?? packed?.[3] ?? english?.[3] ?? englishDayFirst?.[3]);
  let month = Number(iso?.[2] ?? local?.[2] ?? packed?.[2]);
  const day = Number(iso?.[3] ?? local?.[1] ?? packed?.[1] ?? english?.[2] ?? englishDayFirst?.[1]);
  if (english) {
    month = ENGLISH_MONTHS[english[1].toLowerCase()] ?? 0;
  } else if (englishDayFirst) {
    month = ENGLISH_MONTHS[englishDayFirst[2].toLowerCase()] ?? 0;
  }
  if (!iso && !local && !packed && !english && !englishDayFirst) {
    return undefined;
  }
  if (year < 1990 || year > 2100) {
    return undefined;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

