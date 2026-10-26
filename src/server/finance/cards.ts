import { cardOwnerLabel } from "@/server/finance/catalog";

export const FLYWORK_CARDS = ["Anıl Bey kart", "Burç Bey kart"] as const;
export const OFFICE_CARDS = ["Anıl Bey kart", "Tuna Bey kart"] as const;

export const FLYWORK_SPENDERS = ["Tunahan Avşar", "Anıl Can Mayancur"] as const;
export const OFFICE_SPENDERS = FLYWORK_SPENDERS;
export const SPENDER_NAMES = FLYWORK_SPENDERS;

const CURRENCY_ORDER = ["TRY", "USD", "EUR"] as const;

export type CardSpendRow = {
  amount: string;
  currency: string;
  accountLabel: string | null;
};

export type CardSpendTotal = {
  label: string;
  byCurrency: { currency: string; total: string; count: number }[];
};

export function cardsForScope(scope: "EMPLOYEE" | "COMPANY" | "OFFICE"): readonly string[] {
  if (scope === "OFFICE") return OFFICE_CARDS;
  if (scope === "COMPANY") return FLYWORK_CARDS;
  return [];
}

export function isSpenderName(name: string): boolean {
  return (SPENDER_NAMES as readonly string[]).includes(name);
}

function cardKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("tr");
}

export function withAllCurrencies(
  rows: { currency: string; total: string; count: number }[],
): { currency: string; total: string; count: number }[] {
  return CURRENCY_ORDER.map((currency) => {
    const found = rows.find((row) => row.currency === currency);
    return found ?? { currency, total: "0.00", count: 0 };
  });
}

export function summarizeCards(
  rows: CardSpendRow[],
  labels: readonly string[] = FLYWORK_CARDS,
): CardSpendTotal[] {
  const known = new Map(labels.map((label) => [cardKey(label), label]));
  const buckets = new Map<string, Map<string, { total: number; count: number }>>(
    labels.map((label) => [label, new Map()]),
  );

  for (const row of rows) {
    const label = known.get(cardKey(cardOwnerLabel(row.accountLabel) ?? row.accountLabel));
    if (!label) continue;
    const currencies = buckets.get(label);
    if (!currencies) continue;
    const current = currencies.get(row.currency) ?? { total: 0, count: 0 };
    current.total += Number(row.amount);
    current.count += 1;
    currencies.set(row.currency, current);
  }

  return labels.map((label) => ({
    label,
    byCurrency: [...(buckets.get(label)?.entries() ?? [])]
      .sort(([left], [right]) => CURRENCY_ORDER.indexOf(left as (typeof CURRENCY_ORDER)[number]) - CURRENCY_ORDER.indexOf(right as (typeof CURRENCY_ORDER)[number]))
      .map(([currency, value]) => ({
        currency,
        total: value.total.toFixed(2),
        count: value.count,
      })),
  }));
}
