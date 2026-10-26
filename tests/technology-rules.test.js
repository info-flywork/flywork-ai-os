import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { addCycle, daysUntil, reminderThresholds } from "@/server/technology/schedule";
import { parseInput, technologySchema } from "@/server/validation/schemas";

const base = {
  name: "Faz6 Arac",
  vendor: "Faz6 Saglayici",
  kind: "SOFTWARE" ,
  status: "ACTIVE" ,
  amount: "10.00",
  currency: "USD" ,
  billingCycle: "YEARLY" ,
  renewsOn: "2026-11-02",
  paymentMethod: "CARD" ,
  autoRenew: true,
};

describe("teknoloji takvimi", () => {
  it("aylık, yıllık ve özel yenileme tarihini hesaplar", () => {
    expect(addCycle("2026-01-31", "MONTHLY")).toBe("2026-02-28");
    expect(addCycle("2024-02-29", "YEARLY")).toBe("2025-02-28");
    expect(addCycle("2026-10-21", "CUSTOM", 10)).toBe("2026-10-31");
    expect(daysUntil("2026-10-21", "2026-11-02")).toBe(12);
  });

  it("10, 5, 3 ve 1 gün kala birer eşik üretir, gecikmeyi ayrı işaretler", () => {
    expect(reminderThresholds(12)).toEqual([]);
    expect(reminderThresholds(10)).toEqual([10]);
    expect(reminderThresholds(6)).toEqual([10]);
    expect(reminderThresholds(5)).toEqual([10, 5]);
    expect(reminderThresholds(3)).toEqual([10, 5, 3]);
    expect(reminderThresholds(1)).toEqual([10, 5, 3, 1]);
    expect(reminderThresholds(0)).toEqual([10, 5, 3, 1]);
    expect(reminderThresholds(-2)).toEqual([-1]);
  });

  it("hosting, ssl, api ve diğer kategoriyi ayrı alanlarla kabul eder", () => {
    expect(() => parseInput(technologySchema, { ...base, kind: "HOSTING" })).toThrow(AppError);
    expect(() => parseInput(technologySchema, { ...base, kind: "SSL" })).toThrow(AppError);
    expect(parseInput(technologySchema, { ...base, kind: "HOSTING", dnsProvider: "Faz6 DNS" }).dnsProvider).toBe("Faz6 DNS");
    expect(parseInput(technologySchema, { ...base, kind: "SSL", sslIssuer: "Faz6", sslExpiresOn: "2027-01-01" }).sslExpiresOn).toBe("2027-01-01");
    expect(parseInput(technologySchema, { ...base, kind: "API" }).kind).toBe("API");
    expect(parseInput(technologySchema, { ...base, kind: "OTHER", status: "CANCELLED" }).status).toBe("CANCELLED");
  });

  it("kartın tamamını ve eksik alan adını reddeder", () => {
    expect(() => parseInput(technologySchema, { ...base, cardLast4: "4242424242424242" })).toThrow(AppError);
    expect(() => parseInput(technologySchema, { ...base, kind: "DOMAIN" })).toThrow(AppError);
    const saved = parseInput(technologySchema, { ...base, cardLast4: "4242" });
    expect(saved.cardLast4).toBe("4242");
  });
});
