import { describe, expect, it } from "vitest";
import { parsePaymentMail } from "@/server/finance/paymentMail";
import { paymentMailboxQuery } from "@/server/google/gmail";

const SAMPLE = "₺61,24 tutarındaki ödemeniz (referans: CLOUD zCzv4W, Visa •••• 2691) 1 Kas 2026 tarihinde Google Cloud Platform & APIs tarafından alındı.";

const OPENAI_TR =
  "Merhaba FLYWORK, OpenAI API kredi bakiyenizi finanse etmek için 2691 ile biten kredi kartınızdan 20,27 ABD doları tutarında bir ücret tahsil ettik. Fatura geçmişinizi dilediğiniz zaman inceleyebilirsiniz.";

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

  it("OpenAI kart çekimi bildirimini okur", () => {
    expect(parsePaymentMail(OPENAI_TR, { fallbackDate: "Tue, 3 Nov 2026 15:19:00 +0300" })).toEqual({
      amount: "20.27",
      currency: "USD",
      reference: "CARD-2691-2026-11-03-20.27",
      cardLast4: "2691",
      issuedOn: "2026-11-03",
      vendor: "OpenAI API",
    });
  });

  it("OpenAI İngilizce kart çekimini okur", () => {
    expect(
      parsePaymentMail(
        "We charged 20.27 USD to your credit card ending in 2691 to fund your OpenAI API credit balance.",
        { fallbackDate: "2026-11-03" },
      ),
    ).toEqual({
      amount: "20.27",
      currency: "USD",
      reference: "CARD-2691-2026-11-03-20.27",
      cardLast4: "2691",
      issuedOn: "2026-11-03",
      vendor: "OpenAI API",
    });
  });

  it("ödeme bildirimi olmayan yazıyı geçmez", () => {
    expect(parsePaymentMail("Faturanız ektedir. Tutar 10 TL.")).toBeNull();
  });

  it("Gmail ödeme sorgusu kart çekimi ifadelerini kapsar", () => {
    const query = paymentMailboxQuery();
    expect(query).toContain("ücret tahsil ettik");
    expect(query).toContain("account has been funded");
    expect(query).toContain("from:tm.openai.com");
  });
});
