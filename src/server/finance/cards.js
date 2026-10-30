import { cardOwnerLabel } from "@/server/finance/catalog";

export const FLYWORK_CARDS = ["Anıl Bey kart", "Burç Bey kart"] ;
export const OFFICE_CARDS = ["Anıl Bey kart", "Tuna Bey kart"] ;

export const FLYWORK_SPENDERS = ["Tunahan Avşar", "Anıl Can Mayancur"] ;
export const OFFICE_SPENDERS = FLYWORK_SPENDERS;
export const SPENDER_NAMES = FLYWORK_SPENDERS;

const CURRENCY_ORDER = ["TRY", "USD", "EUR"] ;

 
export function cardsForScope(scope) {
  if (scope === "OFFICE") return OFFICE_CARDS;
  if (scope === "COMPANY") return FLYWORK_CARDS;
  return [];
}

export function isSpenderName(name) {
  return (SPENDER_NAMES ).includes(name);
}

export function presetCardCharge(vendor) {
  const name = (vendor ?? "").toLocaleLowerCase("tr");
  if (name.includes("openai") || name.includes("claude")) {
    return { paymentMethod: "CARD", accountLabel: "Anıl Bey kart" };
  }
  return { paymentMethod: "OTHER", accountLabel: null };
}

function cardKey(value) {
  return (value ?? "").trim().toLocaleLowerCase("tr");
}

export function withAllCurrencies(
  rows,
) {
  return CURRENCY_ORDER.map((currency) => {
    const found = rows.find((row) => row.currency === currency);
    return found ?? { currency, total: "0.00", count: 0 };
  });
}

export function summarizeCards(
  rows,
  labels = FLYWORK_CARDS,
) {
  const known = new Map(labels.map((label) => [cardKey(label), label]));
  const buckets = new Map(
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
      .sort(([left], [right]) => CURRENCY_ORDER.indexOf(left ) - CURRENCY_ORDER.indexOf(right ))
      .map(([currency, value]) => ({
        currency,
        total: value.total.toFixed(2),
        count: value.count,
      })),
  }));
}
