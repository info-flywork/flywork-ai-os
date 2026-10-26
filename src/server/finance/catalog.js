export const CURRENCIES = ["TRY", "USD", "EUR"] ;
 

export const PAYMENT_METHODS = ["CARD", "TRANSFER", "CASH", "OTHER"] ;
 

export const EXPENSE_SCOPES = ["EMPLOYEE", "COMPANY", "OFFICE"] ;
 

export const CATEGORIES = [
  "TRANSPORT",
  "MEAL",
  "LODGING",
  "SUPPLIES",
  "SOFTWARE",
  "SERVICE",
  "SUBSCRIPTION",
  "OPERATIONS",
  "CLEANING",
  "RENT",
  "ELECTRICITY",
  "INTERNET",
  "EQUIPMENT",
  "MARKET",
  "WATER",
  "OTHER",
] ;
 

export const CATEGORIES_BY_SCOPE = {
  EMPLOYEE: ["TRANSPORT", "MEAL", "LODGING", "SUPPLIES", "OTHER"],
  COMPANY: ["SOFTWARE", "SERVICE", "SUBSCRIPTION", "OPERATIONS", "OTHER"],
  OFFICE: ["MARKET", "WATER", "MEAL", "CLEANING", "RENT", "ELECTRICITY", "INTERNET", "EQUIPMENT", "OTHER"],
};

export const CATEGORY_LABELS = {
  TRANSPORT: "Ulaşım",
  MEAL: "Yemek",
  LODGING: "Konaklama",
  SUPPLIES: "Malzeme",
  SOFTWARE: "Yazılım",
  SERVICE: "Hizmet",
  SUBSCRIPTION: "Abonelik",
  OPERATIONS: "Operasyon",
  CLEANING: "Temizlik",
  RENT: "Kira",
  ELECTRICITY: "Elektrik",
  INTERNET: "İnternet",
  EQUIPMENT: "Ekipman",
  MARKET: "Market",
  WATER: "Su",
  OTHER: "Diğer",
};

export const PAYMENT_LABELS = {
  CARD: "Kart",
  TRANSFER: "Banka havalesi",
  CASH: "Nakit",
  OTHER: "Diğer",
};

export const STATUS_LABELS = {
  SUBMITTED: "İncelemede",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  PAID: "Ödendi",
} ;

export function categoryFitsScope(scope, category) {
  return CATEGORIES_BY_SCOPE[scope].includes(category);
}

export function vendorKey(vendor) {
  return vendor.trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");
}

 



















const KNOWN_CARD_OWNERS = {
  "2691": "Anıl Bey kart",
  "4799": "Burç Bey kart",
};

export function cardOwnerLabel(value) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length !== 4 && (digits.length < 13 || digits.length > 19)) {
    return null;
  }
  return KNOWN_CARD_OWNERS[digits.slice(-4)] ?? null;
}

export function normalizeAccountLabel(
  paymentMethod,
  value,
) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { value: null, error: null };
  const owner = cardOwnerLabel(trimmed);
  if (owner) return { value: owner, error: null };
  const digits = trimmed.replace(/\D/g, "");
  const digitsOnly = /^[\d\s-]+$/.test(trimmed);
  if (digits.length >= 13 && digits.length <= 19) {
    return { value: digits.slice(-4), error: null };
  }
  if (paymentMethod === "CARD" && digitsOnly && digits.length > 4) {
    return { value: digits.slice(-4), error: null };
  }
  if (paymentMethod === "CARD" && digitsOnly && digits.length > 0 && digits.length < 4) {
    return { value: null, error: "Kart için son 4 hane gerekli." };
  }
  return { value: trimmed.slice(0, 80), error: null };
}

export function redactAccountLabel(value) {
  return normalizeAccountLabel("OTHER", value).value;
}

function add(
  map,
  key,
  amount,
) {
  const current = map.get(key) ?? { total: 0, count: 0 };
  current.total += amount;
  current.count += 1;
  map.set(key, current);
}

function money(value) {
  return value.toFixed(2);
}

export function summarizeSpend(rows) {
  const counted = rows.filter((row) => row.status === "APPROVED" || row.status === "PAID");
  const byCurrency = new Map();
  const byVendor = new Map();
  const byPayment = new Map();
  const byCategory = new Map();

  for (const row of counted) {
    const amount = Number(row.amount);
    add(byCurrency, row.currency, amount);
    add(byVendor, `${row.vendor?.trim() || "Tedarikçi yok"}|${row.currency}`, amount);
    add(byPayment, `${row.paymentMethod}|${row.currency}`, amount);
    if (row.category) add(byCategory, `${row.category}|${row.currency}`, amount);
  }

  return {
    byCurrency: totals(byCurrency),
    byVendor: [...byVendor.entries()].map(([key, value]) => {
      const [vendor, currency] = key.split("|");
      return { vendor, currency, total: money(value.total), count: value.count };
    }),
    byPayment: [...byPayment.entries()].map(([key, value]) => {
      const [paymentMethod, currency] = key.split("|");
      return {
        paymentMethod: paymentMethod ,
        currency,
        total: money(value.total),
        count: value.count,
      };
    }),
    byCategory: [...byCategory.entries()].map(([key, value]) => {
      const [category, currency] = key.split("|");
      return {
        category: category ,
        currency,
        total: money(value.total),
        count: value.count,
      };
    }),
  };
}

function totals(map) {
  return [...map.entries()].map(([currency, value]) => ({
    currency,
    total: money(value.total),
    count: value.count,
  }));
}

export function summarizePending(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.reimbursement !== "PENDING" || row.status === "REJECTED") continue;
    add(map, row.currency, Number(row.amount));
  }
  return totals(map);
}

export function summarizeScopes(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.scope || (row.status !== "APPROVED" && row.status !== "PAID")) continue;
    add(map, `${row.scope}|${row.currency}`, Number(row.amount));
  }
  return [...map.entries()].map(([key, value]) => {
    const [scope, currency] = key.split("|");
    return { scope: scope , currency, total: money(value.total), count: value.count };
  });
}
