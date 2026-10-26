export type MoneyParse = {
  state: "certain" | "uncertain" | "missing";
  value?: string;
};

export function parseMoney(value: string | null | undefined): MoneyParse {
  if (!value || !value.trim()) {
    return { state: "missing" };
  }
  const compact = value.trim().replace(/\s+/g, "").replace(/(try|usd|eur|tl)$/i, "");
  if (!/^\d[\d.,]*$/.test(compact)) {
    return { state: "uncertain" };
  }
  const dot = compact.lastIndexOf(".");
  const comma = compact.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    const decimalSep = dot > comma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    const whole = compact.slice(0, compact.lastIndexOf(decimalSep));
    const fraction = compact.slice(compact.lastIndexOf(decimalSep) + 1);
    return grouped(whole, fraction, thousandSep);
  }
  const sep = comma >= 0 ? "," : dot >= 0 ? "." : "";
  if (!sep) {
    return /^\d+$/.test(compact) && compact.length <= 10
      ? { state: "certain", value: formatMoney(compact, "00") }
      : { state: "uncertain" };
  }
  const parts = compact.split(sep);
  const fraction = parts[parts.length - 1] ?? "";
  const whole = parts.slice(0, -1).join("");
  if (parts.length === 2 && fraction.length === 2 && /^\d+$/.test(whole) && /^\d{2}$/.test(fraction)) {
    return { state: "certain", value: formatMoney(whole, fraction) };
  }
  return { state: "uncertain" };
}

export function moneyConflict(amount: string, tax: string): boolean {
  const total = parseMoney(amount);
  const vat = parseMoney(tax);
  if (total.state !== "certain" || vat.state !== "certain" || !total.value || !vat.value) {
    return false;
  }
  return Number(vat.value) > Number(total.value) + 0.001;
}

function grouped(whole: string, fraction: string, thousandSep: string): MoneyParse {
  if (!/^\d{1,2}$/.test(fraction)) {
    return { state: "uncertain" };
  }
  const groups = whole.split(thousandSep);
  const groupedWell = groups.every((group, index) => /^\d+$/.test(group) && (index === 0 ? group.length >= 1 && group.length <= 3 : group.length === 3));
  const value = groupedWell && groups.length >= 2 ? formatMoney(groups.join(""), fraction) : "";
  if (!value) {
    return { state: "uncertain" };
  }
  return { state: "certain", value };
}

function formatMoney(whole: string, fraction: string): string {
  const digits = whole.replace(/^0+(?=\d)/, "") || "0";
  if (digits.length > 10) {
    return "";
  }
  return `${digits}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}
