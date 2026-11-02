import { describe, expect, it } from "vitest";
import { parsePaymentMail } from "@/server/finance/paymentMail";

const SAMPLE = "₺61,24 tutarındaki ödemeniz (referans: CLOUD zCzv4W, Visa •••• 2691) 1 Kas 2026 tarihinde Google Cloud Platform & APIs tarafından alındı.";

describe("ödeme alındı mektubu", () => {
  it("Google Cloud ödeme bildirimini okur", () => {
    expect(parsePaymentMail(SAMPLE)).toEqual({
      amount: "61.24",
      currency: "TRY",
      reference: "CLOUD zCzv4W",
      cardLast4: "2691",
      issuedOn: "2026-11-01",
      vendor: "Google Cloud Platform & APIs",
    });
  });

  it("ödeme bildirimi olmayan yazıyı geçmez", () => {
    expect(parsePaymentMail("Faturanız ektedir. Tutar 10 TL.")).toBeNull();
  });
});
