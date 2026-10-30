import { vendorKey } from "@/server/finance/catalog";
import { canAutoApprove } from "@/server/finance/reviewRules";

export function matchesAutoApprove(rule, draft, missing, uncertain) {
  if (!rule?.enabled) {
    return false;
  }
  const names = (Array.isArray(rule.vendors) ? rule.vendors : [])
    .map((name) => vendorKey(String(name)))
    .filter((name) => name.length >= 2);
  if (!rule.vendors || names.length === 0) {
    return false;
  }
  const vendor = vendorKey(draft.vendor ?? "");
  if (!names.includes(vendor)) {
    return false;
  }
  const amount = Number(draft.amount);
  const max = Number(rule.maxAmount);
  const currency = String(draft.currency ?? "").trim().toUpperCase();
  if (!Number.isFinite(amount) || !Number.isFinite(max) || max <= 0) {
    return false;
  }
  if (currency !== String(rule.currency ?? "TRY").trim().toUpperCase()) {
    return false;
  }
  if (!(amount < max)) {
    return false;
  }
  return canAutoApprove(draft, missing, uncertain);
}
