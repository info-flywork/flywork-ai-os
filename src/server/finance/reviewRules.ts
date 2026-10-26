import { CURRENCIES } from "@/server/finance/catalog";
import { moneyConflict, parseMoney } from "@/server/finance/money";
import { AppError } from "@/server/errors";

export const REVIEW_FIELDS = [
  "vendor",
  "number",
  "issuedOn",
  "amount",
  "currency",
  "tax",
  "documentType",
] as const;

export type ReviewField = (typeof REVIEW_FIELDS)[number];
export type ReviewDraft = Record<ReviewField, string>;
export type ReviewStatus = "PENDING" | "HELD" | "REJECTED" | "APPROVED" | "DRIVE_FAILED";

export const REVIEW_LABELS: Record<ReviewField, string> = {
  vendor: "Tedarikçi",
  number: "Fatura numarası",
  issuedOn: "Tarih",
  amount: "Tutar",
  currency: "Para birimi",
  tax: "Vergi",
  documentType: "Belge türü",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  PENDING: "İnceleme bekliyor",
  HELD: "Bekletildi",
  REJECTED: "Reddedildi",
  APPROVED: "Onaylandı ve arşivlendi",
  DRIVE_FAILED: "Kayıt oluşturuldu, Drive yüklemesi bekliyor",
};

const PREVIEW_LABELS: { label: string; key: ReviewField }[] = [
  { label: "Tedarikçi", key: "vendor" },
  { label: "Fatura no", key: "number" },
  { label: "Tarih", key: "issuedOn" },
  { label: "Tutar", key: "amount" },
  { label: "Para birimi", key: "currency" },
  { label: "Vergi", key: "tax" },
  { label: "Belge türü", key: "documentType" },
];

export function emptyDraft(): ReviewDraft {
  return {
    vendor: "",
    number: "",
    issuedOn: "",
    amount: "",
    currency: "",
    tax: "",
    documentType: "",
  };
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validAmount(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0;
}

export function validTax(value: string): boolean {
  return value === "" || (/^\d+(\.\d{1,2})?$/.test(value) && Number(value) >= 0);
}

export function validCurrency(value: string): boolean {
  return (CURRENCIES as readonly string[]).includes(value);
}

export function canAutoApprove(draft: ReviewDraft, missing: string[], uncertain: string[]): boolean {
  if (missing.length > 0 || uncertain.length > 0) {
    return false;
  }
  if (draft.documentType !== "INVOICE" && draft.documentType !== "RECEIPT") {
    return false;
  }
  return reviewIssues(draft).length === 0;
}

export function reviewIssues(draft: ReviewDraft): string[] {
  const issues: string[] = [];
  if (draft.vendor.trim().length < 2) {
    issues.push(REVIEW_LABELS.vendor);
  }
  if (draft.number.trim().length < 1) {
    issues.push(REVIEW_LABELS.number);
  }
  if (!validDate(draft.issuedOn.trim())) {
    issues.push(REVIEW_LABELS.issuedOn);
  }
  if (!validAmount(draft.amount.trim())) {
    issues.push(REVIEW_LABELS.amount);
  } else if (moneyConflict(draft.amount, draft.tax)) {
    issues.push("Tutar ve vergi tutarsız");
  }
  if (!validCurrency(draft.currency.trim().toUpperCase())) {
    issues.push(REVIEW_LABELS.currency);
  }
  if (!validTax(draft.tax.trim())) {
    issues.push(REVIEW_LABELS.tax);
  }
  if (draft.documentType !== "INVOICE" && draft.documentType !== "RECEIPT") {
    issues.push(REVIEW_LABELS.documentType);
  }
  return issues;
}

export function fieldCorrections(
  before: ReviewDraft,
  after: ReviewDraft,
): Record<string, { once: string; sonra: string }> {
  const corrections: Record<string, { once: string; sonra: string }> = {};
  for (const key of REVIEW_FIELDS) {
    const left = before[key].trim();
    const right = after[key].trim();
    if (left !== right) {
      corrections[key] = { once: left, sonra: right };
    }
  }
  return corrections;
}

export function approvalRoute(input: {
  status: ReviewStatus;
  driveFileId: string | null;
  invoiceId: string | null;
  otherHashInvoiceId: string | null;
  otherVendorInvoiceId: string | null;
}): "already" | "retry" | "create" {
  if (input.status === "REJECTED") {
    throw new AppError("Reddedilen belge onaylanamaz.", "VALIDATION", 400);
  }
  if (input.driveFileId) {
    return "already";
  }
  if (input.otherHashInvoiceId && input.otherHashInvoiceId !== input.invoiceId) {
    throw new AppError("Bu dosya daha önce kaydedilmiş.", "CONFLICT", 409);
  }
  if (input.otherVendorInvoiceId && input.otherVendorInvoiceId !== input.invoiceId) {
    throw new AppError("Bu tedarikçi ve belge numarası kayıtlı.", "CONFLICT", 409);
  }
  return input.invoiceId ? "retry" : "create";
}

export function parsePreviewFields(line: string): {
  draft: ReviewDraft;
  missing: ReviewField[];
  uncertain: ReviewField[];
} | null {
  if (!line.includes("Tedarikçi:")) {
    return null;
  }
  const draft = emptyDraft();
  const missing: ReviewField[] = [];
  const uncertain: ReviewField[] = [];
  const positions = PREVIEW_LABELS
    .map((item) => ({ ...item, at: line.indexOf(`${item.label}:`) }))
    .filter((item) => item.at >= 0)
    .sort((left, right) => left.at - right.at);
  for (let index = 0; index < positions.length; index += 1) {
    const current = positions[index];
    const start = current.at + current.label.length + 1;
    const end = index + 1 < positions.length ? positions[index + 1].at : line.length;
    let value = line.slice(start, end).trim();
    if (index + 1 >= positions.length) {
      const marker = value.indexOf(". ");
      if (marker >= 0) {
        value = value.slice(0, marker);
      }
    }
    value = value.replace(/\.\s*$/, "").trim();
    if (value === "eksik" || value === "") {
      missing.push(current.key);
      continue;
    }
    if (value === "belirsiz") {
      uncertain.push(current.key);
      continue;
    }
    if (current.key === "documentType") {
      const kind = value.toLocaleLowerCase("tr");
      draft.documentType = kind === "fatura"
        ? "INVOICE"
        : kind === "fiş" || kind === "fis"
          ? "RECEIPT"
          : kind === "fatura değil"
            ? "NOT_INVOICE"
            : "";
      if (!draft.documentType) {
        missing.push(current.key);
      }
      continue;
    }
    draft[current.key] = value;
  }
  for (const item of PREVIEW_LABELS) {
    if (!positions.some((position) => position.key === item.key) && !missing.includes(item.key)) {
      missing.push(item.key);
    }
  }
  return { draft, missing, uncertain };
}

export function draftFromForm(formData: FormData): ReviewDraft {
  const draft = emptyDraft();
  for (const key of REVIEW_FIELDS) {
    draft[key] = String(formData.get(key) ?? "").trim();
  }
  draft.currency = draft.currency.toUpperCase();
  draft.amount = normalizeFormMoney(draft.amount);
  draft.tax = normalizeFormMoney(draft.tax);
  return draft;
}

function normalizeFormMoney(value: string): string {
  const parsed = parseMoney(value);
  return parsed.state === "certain" && parsed.value ? parsed.value : value;
}
