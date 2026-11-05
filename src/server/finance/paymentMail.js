const MONTHS = {
  ocak: 1,
  oca: 1,
  şubat: 2,
  subat: 2,
  şub: 2,
  sub: 2,
  mart: 3,
  mar: 3,
  nisan: 4,
  nis: 4,
  mayıs: 5,
  mayis: 5,
  may: 5,
  haziran: 6,
  haz: 6,
  temmuz: 7,
  tem: 7,
  ağustos: 8,
  agustos: 8,
  ağu: 8,
  agu: 8,
  eylül: 9,
  eylul: 9,
  eyl: 9,
  ekim: 10,
  eki: 10,
  kasım: 11,
  kasim: 11,
  kas: 11,
  aralık: 12,
  aralik: 12,
  ara: 12,
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function money(raw) {
  const trimmed = raw.trim();
  if (trimmed.includes(",") && trimmed.includes(".")) {
    const decimal = trimmed.lastIndexOf(",") > trimmed.lastIndexOf(".") ? "," : ".";
    const normalized = decimal === ","
      ? trimmed.replace(/\./g, "").replace(",", ".")
      : trimmed.replace(/,/g, "");
    return normalized;
  }
  if (trimmed.includes(",")) return trimmed.replace(",", ".");
  return trimmed;
}

function currencyOf(token) {
  const raw = (token ?? "").trim();
  const key = raw.toLocaleLowerCase("tr");
  if (raw === "₺" || key === "tl" || key === "try" || key.includes("türk lirası") || key.includes("turk lirasi")) {
    return "TRY";
  }
  if (
    raw === "$" ||
    key === "usd" ||
    key.includes("abd dolar") ||
    key.includes("us dollar") ||
    key === "dollar" ||
    key === "dollars"
  ) {
    return "USD";
  }
  if (raw === "€" || key === "eur" || key.includes("euro") || key.includes("avro")) {
    return "EUR";
  }
  return "";
}

function issuedFromParts(day, monthToken, year) {
  const month = MONTHS[String(monthToken ?? "").toLocaleLowerCase("tr").replace(/\.$/, "")];
  const d = Number(day);
  const y = Number(year);
  if (!month || d < 1 || d > 31 || y < 2000) return "";
  return `${y}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function issuedFromFallback(raw) {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function cleanVendor(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^(merhaba|hello|hi)\s+[^,]+,\s*/i, "")
    .replace(/^(to\s+fund\s+your\s+)/i, "")
    .replace(/\bkredi bakiyenizi\b.*$/i, "")
    .replace(/\bcredit balance\b.*$/i, "")
    .trim()
    .slice(0, 160);
}

function vendorFromText(plain, fallback = "") {
  if (/openai\s+api/i.test(plain)) return "OpenAI API";
  if (/openai/i.test(plain)) return "OpenAI";
  if (/anthropic|claude/i.test(plain)) return "Anthropic";
  if (/google\s+cloud/i.test(plain)) return "Google Cloud";
  return cleanVendor(fallback);
}

function paymentResult({ amount, currency, reference, cardLast4, issuedOn, vendor }) {
  const numeric = Number(amount);
  if (!currency || !issuedOn || vendor.length < 2 || reference.length < 2) return null;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return {
    amount: numeric.toFixed(2),
    currency,
    reference: reference.slice(0, 80),
    cardLast4: cardLast4 || "",
    issuedOn,
    vendor: vendor.slice(0, 160),
  };
}

function parseReceivedPayment(plain) {
  const match = plain.match(
    /([₺$€]|TL|USD|EUR|TRY)?\s*(\d{1,10}(?:[.,]\d{3})*[.,]\d{2})\s*tutarındaki ödemeniz\s*\(\s*referans:\s*([^,)]+?)\s*,\s*[^)]*?(\d{4})\s*\)\s*(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü.]+)\s+(\d{4})\s+tarihinde\s+(.+?)\s+tarafından alındı/i,
  );
  if (!match) return null;
  return paymentResult({
    amount: money(match[2]),
    currency: currencyOf(match[1] || "TRY"),
    reference: match[3].trim(),
    cardLast4: match[4],
    issuedOn: issuedFromParts(match[5], match[6], match[7]),
    vendor: cleanVendor(match[8]),
  });
}

function parseCardChargePayment(plain, fallbackDate) {
  const tr = plain.match(
    /([A-Za-z0-9][A-Za-z0-9 .,&+_-]{1,80}?)\s+kredi bakiyenizi finanse etmek için\s+(\d{4})\s+ile biten kredi kartınızdan\s+(\d{1,10}(?:[.,]\d{3})*[.,]\d{2})\s+(ABD doları|ABD Doları|US dollars?|USD|\$|EUR|€|TRY|TL|₺|Türk lirası|Turk lirasi|Euro|Avro)\s+tutarında bir ücret tahsil ettik/i,
  );
  if (tr) {
    const amount = money(tr[3]);
    const currency = currencyOf(tr[4]);
    const cardLast4 = tr[2];
    const issuedOn = fallbackDate || "";
    return paymentResult({
      amount,
      currency,
      reference: `CARD-${cardLast4}-${issuedOn}-${amount}`,
      cardLast4,
      issuedOn,
      vendor: vendorFromText(plain, tr[1]),
    });
  }

  const trGeneric = plain.match(
    /(\d{4})\s+ile biten kredi kartınızdan\s+(\d{1,10}(?:[.,]\d{3})*[.,]\d{2})\s+(ABD doları|ABD Doları|US dollars?|USD|\$|EUR|€|TRY|TL|₺|Türk lirası|Turk lirasi|Euro|Avro)\s+tutarında bir ücret tahsil ettik/i,
  );
  if (trGeneric && /(?:tahsil ettik|para yatırıldı|finanse)/i.test(plain)) {
    const amount = money(trGeneric[2]);
    const currency = currencyOf(trGeneric[3]);
    const cardLast4 = trGeneric[1];
    const issuedOn = fallbackDate || "";
    return paymentResult({
      amount,
      currency,
      reference: `CARD-${cardLast4}-${issuedOn}-${amount}`,
      cardLast4,
      issuedOn,
      vendor: vendorFromText(plain, "Kart tahsilatı"),
    });
  }

  const en = plain.match(
    /we(?:'ve| have)?\s+charged\s+(?:a\s+fee\s+of\s+)?(?:([₺$€]|USD|EUR|TRY|TL)\s*)?(\d{1,10}(?:[.,]\d{3})*[.,]\d{2})\s*(ABD doları|US dollars?|USD|\$|EUR|€|TRY|TL|₺)?\s+to\s+your\s+credit\s+card\s+ending\s+in\s+(\d{4})(?:\s+to\s+fund\s+your\s+(.+?)\s+credit\s+balance)?/i,
  );
  if (en) {
    const amount = money(en[2]);
    const currency = currencyOf(en[1] || en[3] || "USD");
    const cardLast4 = en[4];
    const issuedOn = fallbackDate || "";
    return paymentResult({
      amount,
      currency,
      reference: `CARD-${cardLast4}-${issuedOn}-${amount}`,
      cardLast4,
      issuedOn,
      vendor: vendorFromText(plain, en[5] || "Kart tahsilatı"),
    });
  }

  const enAlt = plain.match(
    /(?:credit\s+card|card)\s+ending\s+in\s+(\d{4}).{0,80}?([₺$€]|USD|EUR|TRY|TL)?\s*(\d{1,10}(?:[.,]\d{3})*[.,]\d{2})\s*(ABD doları|US dollars?|USD|\$|EUR|€|TRY|TL|₺)?/i,
  );
  if (enAlt && /(?:charged|funded|payment|tahsil)/i.test(plain)) {
    const amount = money(enAlt[3]);
    const currency = currencyOf(enAlt[2] || enAlt[4] || "USD");
    const cardLast4 = enAlt[1];
    const issuedOn = fallbackDate || "";
    return paymentResult({
      amount,
      currency,
      reference: `CARD-${cardLast4}-${issuedOn}-${amount}`,
      cardLast4,
      issuedOn,
      vendor: vendorFromText(plain, "Kart tahsilatı"),
    });
  }

  return null;
}

export function parsePaymentMail(text, options = {}) {
  const plain = (text ?? "").replace(/\s+/g, " ").trim();
  if (!plain) return null;
  const fallbackDate = issuedFromFallback(options.fallbackDate);
  return parseReceivedPayment(plain) ?? parseCardChargePayment(plain, fallbackDate);
}
