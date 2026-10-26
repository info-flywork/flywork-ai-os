import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import {
  approvalRoute,
  emptyDraft,
  fieldCorrections,
  parsePreviewFields,
  canAutoApprove,
  reviewIssues,
} from "@/server/finance/reviewRules";

describe("fatura inceleme kuralları", () => {
  it("eksik tarihi onaydan önce yakalar", () => {
    const draft = emptyDraft();
    draft.vendor = "Ornek Ltd";
    draft.number = "FW-1";
    draft.amount = "10.00";
    draft.currency = "TRY";
    draft.documentType = "INVOICE";
    expect(reviewIssues(draft)).toContain("Tarih");
    expect(canAutoApprove(draft, [], [])).toBe(false);
    draft.issuedOn = "2026-10-23";
    expect(canAutoApprove(draft, [], [])).toBe(true);
    expect(canAutoApprove(draft, ["amount"], [])).toBe(false);
  });

  it("önizleme satırındaki eksik ve belirsiz alanları ayırır", () => {
    const parsed = parsePreviewFields(
      "1. Okunamadı. Tedarikçi: Ornek Ltd. Fatura no: FW-1. Tarih: eksik. Tutar: 10.00. Para birimi: TRY. Vergi: belirsiz. Belge türü: fatura. Hash mükerrer: hayır.",
    );
    expect(parsed?.draft.vendor).toBe("Ornek Ltd");
    expect(parsed?.draft.amount).toBe("10.00");
    expect(parsed?.draft.issuedOn).toBe("");
    expect(parsed?.missing).toContain("issuedOn");
    expect(parsed?.uncertain).toContain("tax");
    expect(parsed?.draft.documentType).toBe("INVOICE");
  });

  it("ikinci onay ve mükerrer dosyayı ayırır", () => {
    expect(approvalRoute({
      status: "APPROVED",
      driveFileId: "dosya",
      invoiceId: "kayit",
      otherHashInvoiceId: "kayit",
      otherVendorInvoiceId: "kayit",
    })).toBe("already");
    expect(() => approvalRoute({
      status: "PENDING",
      driveFileId: null,
      invoiceId: null,
      otherHashInvoiceId: "baska",
      otherVendorInvoiceId: null,
    })).toThrow(AppError);
  });

  it("yönetici düzeltmesini kayıt farkı olarak tutar", () => {
    const before = emptyDraft();
    before.vendor = "Ornek Ltd";
    const after = { ...before, issuedOn: "2026-10-21" };
    expect(fieldCorrections(before, after).issuedOn).toEqual({ once: "", sonra: "2026-10-21" });
  });
});
