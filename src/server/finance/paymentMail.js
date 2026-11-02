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
  if (token === "₺" || token === "TL" || token === "TRY") return "TRY";
  if (token === "$" || token === "USD") return "USD";
  if (token === "€" || token === "EUR") return "EUR";
  return "";
}

export function parsePaymentMail(text) {
  const plain = (text ?? "").replace(/\s+/g, " ").trim();
  const match = plain.match(
    /([₺$€]|TL|USD|EUR|TRY)?\s*(\d{1,10}(?:[.,]\d{3})*[.,]\d{2})\s*tutarındaki ödemeniz\s*\(\s*referans:\s*([^,)]+?)\s*,\s*[^)]*?(\d{4})\s*\)\s*(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü.]+)\s+(\d{4})\s+tarihinde\s+(.+?)\s+tarafından alındı/i,
  );
  if (!match) return null;
  const currency = currencyOf(match[1] || "TRY");
  const amount = money(match[2]);
  const reference = match[3].trim();
  const day = Number(match[5]);
  const month = MONTHS[match[6].toLocaleLowerCase("tr").replace(/\.$/, "")];
  const year = Number(match[7]);
  const vendor = match[8].trim().replace(/\s+/g, " ");
  if (!currency || !month || day < 1 || day > 31 || year < 2000 || vendor.length < 2 || reference.length < 2) {
    return null;
  }
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const issuedOn = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    amount: numeric.toFixed(2),
    currency,
    reference: reference.slice(0, 80),
    cardLast4: match[4],
    issuedOn,
    vendor: vendor.slice(0, 160),
  };
}
