import { describe, expect, it } from "vitest";

import { invoiceMailboxQuery, GMAIL_QUERIES } from "@/server/google/gmail";
import { isOwnCompanyName } from "@/server/finance/ownCompany";
import { invoiceSummary } from "@/server/google/invoices";

describe("fatura yönü ve tarama penceresi", () => {
  it("kendi şirketimizin kestiği faturayı gelen saymaz", () => {
    expect(isOwnCompanyName("FLY WORK VENTURES YAZILIM ANONİM ŞİRKETİ")).toBe(true);
    expect(isOwnCompanyName("Flywork Ventures Yazılım A.Ş.")).toBe(true);
    expect(isOwnCompanyName("Ornek Tedarik Ltd.")).toBe(false);
  });

  it("son başarılı taramadan sonraki postaları sorgular", () => {
    expect(invoiceMailboxQuery(undefined)).toBe(GMAIL_QUERIES.invoices);
    const since = new Date("2026-10-29T09:00:00.000Z");
    const query = invoiceMailboxQuery(since);
    expect(query.startsWith(`${GMAIL_QUERIES.invoices} after:`)).toBe(true);
    expect(query.endsWith(String(Math.floor(since.getTime() / 1000) - 120))).toBe(true);
  });

  it("çalışma özetinde yeni, işlenen, atlanan ve hata sayılarını yazar", () => {
    const text = invoiceSummary({
      connected: true,
      found: 2,
      processed: [{}],
      skipped: 0,
      outgoing: 1,
      errors: ["okunamadı"],
      retryable: 0,
    });
    expect(text).toContain("Yeni bulunan 2");
    expect(text).toContain("işlenen 1");
    expect(text).toContain("atlanan 0");
    expect(text).toContain("hata 1");
    expect(text).toContain("Giden fatura 1");
  });
});
