import { describe, expect, it } from "vitest";
import { JOB_DEFINITIONS } from "@/server/automation/catalog";
import { classifyAttachment } from "@/server/automation/handlers";
import {
  istanbulInstant,
  nextOccurrence,
  retryDelayMs,
  windowKeyFromInstant,
} from "@/server/automation/schedule";
import { connectionReport } from "@/server/automation/connections";

describe("otomasyon zamanı", () => {
  it("İstanbul saatine göre bir sonraki pencereyi seçer", () => {
    const daily = { weekdays: [] as number[], hour: 8, minute: 30 };
    const before = istanbulInstant("2026-10-21", 8, 29);
    expect(windowKeyFromInstant(nextOccurrence(daily, before))).toBe("2026-10-21T08:30");
    const exact = istanbulInstant("2026-10-21", 8, 30);
    expect(windowKeyFromInstant(nextOccurrence(daily, exact))).toBe("2026-10-22T08:30");
  });

  it("yemek kapanışını pazartesi, salı ve perşembe 11:00'a koyar", () => {
    const meals = JOB_DEFINITIONS.find((job) => job.key === "ops.meal-close");
    expect(meals).toMatchObject({ weekdays: [1, 2, 4], hour: 11, minute: 0 });
    const wednesday = istanbulInstant("2026-10-21", 10, 0);
    expect(windowKeyFromInstant(nextOccurrence(meals!, wednesday))).toBe("2026-10-22T11:00");
    const thursdayAfter = istanbulInstant("2026-10-22", 11, 1);
    expect(windowKeyFromInstant(nextOccurrence(meals!, thursdayAfter))).toBe("2026-10-26T11:00");
    const roster = JOB_DEFINITIONS.find((job) => job.key === "ops.meal-roster");
    expect(roster).toMatchObject({ weekdays: [1, 2, 4], hour: 11, minute: 5 });
    expect(windowKeyFromInstant(nextOccurrence(roster!, thursdayAfter))).toBe("2026-10-22T11:05");
  });

  it("fatura taramasını günde iki kez çalıştırır ve ikinci bir görev açmaz", () => {
    const invoiceJobs = JOB_DEFINITIONS.filter((job) => job.agent === "invoice");
    expect(invoiceJobs.map((job) => job.key)).toEqual(["invoice.morning", "invoice.evening"]);
    expect(invoiceJobs.map((job) => [job.hour, job.minute, job.weekdays])).toEqual([
      [9, 0, []],
      [18, 30, []],
    ]);
    const beforeMorning = istanbulInstant("2026-10-21", 8, 59);
    expect(windowKeyFromInstant(nextOccurrence(invoiceJobs[0], beforeMorning))).toBe("2026-10-21T09:00");
    const afterEvening = istanbulInstant("2026-10-21", 18, 30);
    expect(windowKeyFromInstant(nextOccurrence(invoiceJobs[1], afterEvening))).toBe("2026-10-22T18:30");
  });

  it("hata sonrası deneme aralığını büyütür", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(300_000);
    expect(retryDelayMs(3)).toBe(900_000);
  });

  it("fatura olmayan eki eler ve bağlantıyı kapalı gösterir", () => {
    expect(classifyAttachment("teklif.pdf", "Proforma teklif")).toBe("REJECT");
    expect(classifyAttachment("cv.pdf", "deneyim")).toBe("REJECT");
    expect(
      classifyAttachment("fatura.pdf", "Fatura No: FW-100\nTedarikci: Ornek Ltd\n2026-10-21\n150.00 TRY"),
    ).toBe("INVOICE");
    const connections = connectionReport();
    expect(connections.gmail.connected).toBe(false);
    expect(connections.ai.configured).toBe(Boolean(process.env.AI_DOCUMENT_API_KEY));
    expect(connections.telegram.delivered).toBe(false);
    expect(connections.telegram.delivery).toBe("off");
    expect(connections.email.delivered).toBe(false);
  });
});
