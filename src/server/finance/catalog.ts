export const CURRENCIES = ["TRY", "USD", "EUR"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const PAYMENT_METHODS = ["CARD", "TRANSFER", "CASH", "OTHER"] as const;
export type PaymentCode = (typeof PAYMENT_METHODS)[number];

export const EXPENSE_SCOPES = ["EMPLOYEE", "COMPANY", "OFFICE"] as const;
export type ScopeCode = (typeof EXPENSE_SCOPES)[number];

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
] as const;
export type CategoryCode = (typeof CATEGORIES)[number];

export const CATEGORIES_BY_SCOPE: Record<ScopeCode, readonly CategoryCode[]> = {
  EMPLOYEE: ["TRANSPORT", "MEAL", "LODGING", "SUPPLIES", "OTHER"],
  COMPANY: ["SOFTWARE", "SERVICE", "SUBSCRIPTION", "OPERATIONS", "OTHER"],
  OFFICE: ["MARKET", "WATER", "MEAL", "CLEANING", "RENT", "ELECTRICITY", "INTERNET", "EQUIPMENT", "OTHER"],
};

export const CATEGORY_LABELS: Record<CategoryCode, string> = {
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

export const PAYMENT_LABELS: Record<PaymentCode, string> = {
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
} as const;

export function categoryFitsScope(scope: ScopeCode, category: CategoryCode): boolean {
  return CATEGORIES_BY_SCOPE[scope].includes(category);
}

export function vendorKey(vendor: string): string {
  return vendor.trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");
}

export type MoneyRow = {
  amount: string;
  currency: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID";
  vendor: string | null;
  paymentMethod: PaymentCode;
  category?: CategoryCode;
  reimbursement?: "NOT_REQUIRED" | "PENDING" | "PAID";
  scope?: ScopeCode;
};

export type MoneyReport = {
  byCurrency: { currency: string; total: string; count: number }[];
  byVendor: { vendor: string; currency: string; total: string; count: number }[];
  byPayment: { paymentMethod: PaymentCode; currency: string; total: string; count: number }[];
  byCategory: { category: CategoryCode; currency: string; total: string; count: number }[];
};

export type CurrencyTotal = { currency: string; total: string; count: number };

const KNOWN_CARD_OWNERS: Record<string, string> = {
  "2691": "Anıl Bey kart",
  "4799": "Burç Bey kart",
};

export function cardOwnerLabel(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length !== 4 && (digits.length < 13 || digits.length > 19)) {
    return null;
  }
  return KNOWN_CARD_OWNERS[digits.slice(-4)] ?? null;
}

export function normalizeAccountLabel(
  paymentMethod: string,
  value: string | null | undefined,
): { value: string | null; error: string | null } {
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

export function redactAccountLabel(value: string | null | undefined): string | null {
  return normalizeAccountLabel("OTHER", value).value;
}

function add(
  map: Map<string, { total: number; count: number }>,
  key: string,
  amount: number,
) {
  const current = map.get(key) ?? { total: 0, count: 0 };
  current.total += amount;
  current.count += 1;
  map.set(key, current);
}

function money(value: number): string {
  return value.toFixed(2);
}

export function summarizeSpend(rows: MoneyRow[]): MoneyReport {
  const counted = rows.filter((row) => row.status === "APPROVED" || row.status === "PAID");
  const byCurrency = new Map<string, { total: number; count: number }>();
  const byVendor = new Map<string, { total: number; count: number }>();
  const byPayment = new Map<string, { total: number; count: number }>();
  const byCategory = new Map<string, { total: number; count: number }>();

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
        paymentMethod: paymentMethod as PaymentCode,
        currency,
        total: money(value.total),
        count: value.count,
      };
    }),
    byCategory: [...byCategory.entries()].map(([key, value]) => {
      const [category, currency] = key.split("|");
      return {
        category: category as CategoryCode,
        currency,
        total: money(value.total),
        count: value.count,
      };
    }),
  };
}

function totals(map: Map<string, { total: number; count: number }>): CurrencyTotal[] {
  return [...map.entries()].map(([currency, value]) => ({
    currency,
    total: money(value.total),
    count: value.count,
  }));
}

export function summarizePending(rows: MoneyRow[]): CurrencyTotal[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    if (row.reimbursement !== "PENDING" || row.status === "REJECTED") continue;
    add(map, row.currency, Number(row.amount));
  }
  return totals(map);
}

export function summarizeScopes(rows: MoneyRow[]): { scope: ScopeCode; currency: string; total: string; count: number }[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    if (!row.scope || (row.status !== "APPROVED" && row.status !== "PAID")) continue;
    add(map, `${row.scope}|${row.currency}`, Number(row.amount));
  }
  return [...map.entries()].map(([key, value]) => {
    const [scope, currency] = key.split("|");
    return { scope: scope as ScopeCode, currency, total: money(value.total), count: value.count };
  });
}
