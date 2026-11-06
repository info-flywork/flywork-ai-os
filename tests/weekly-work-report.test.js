import { describe, expect, it } from "vitest";
import { workWeekBounds, renderWeeklyWorkReportText } from "@/server/work/weeklyReport";

describe("workWeekBounds", () => {
  it("cuma akşamı o haftanın pazartesi-cumasını alır", () => {
    const bounds = workWeekBounds(new Date("2026-11-06T19:00:00+03:00"));
    expect(bounds.monday).toBe("2026-11-02");
    expect(bounds.friday).toBe("2026-11-06");
  });

  it("cumartesi sabahı aynı haftayı iletir", () => {
    const bounds = workWeekBounds(new Date("2026-11-07T08:00:00+03:00"));
    expect(bounds.monday).toBe("2026-11-02");
    expect(bounds.friday).toBe("2026-11-06");
  });
});

describe("renderWeeklyWorkReportText", () => {
  it("özet ve kişi satırlarını üretir", () => {
    const text = renderWeeklyWorkReportText(
      {
        rangeLabel: "2 Kasım — 6 Kasım 2026 Cuma",
        generatedAt: "2026-11-06 · 19:00",
        peopleCount: 1,
        totalMinutes: 90,
        cardCount: 1,
        commentCount: 1,
        appCount: 1,
        people: [
          {
            name: "Emrah Doğan",
            minutes: 90,
            jobs: [{
              title: "Pocket Factory",
              appName: "Tiny Shift",
              minutes: 90,
              comments: [{ authorName: "Emrah Doğan", body: "Seviye 3 tasarımı bitti", at: "2026-11-04 · 14:00" }],
            }],
          },
        ],
        jobs: [{
          title: "Pocket Factory",
          appName: "Tiny Shift",
          minutes: 90,
          people: [{ name: "Emrah Doğan", minutes: 90 }],
          comments: [{ authorName: "Emrah Doğan", body: "Seviye 3 tasarımı bitti", at: "2026-11-04 · 14:00" }],
        }],
        apps: [{ name: "Tiny Shift", cardCount: 1, minutes: 90 }],
        days: [{ label: "2 Kasım 2026 Pazartesi", peopleCount: 1, minutes: 90 }],
      },
      "Yorumlara göre tasarım ilerlemesi net.",
    );
    expect(text).toContain("Haftalık Çalışma Raporu");
    expect(text).toContain("Emrah Doğan · 1 sa 30 dk");
    expect(text).toContain("Seviye 3 tasarımı bitti");
    expect(text).toContain("İş bazlı");
    expect(text).toContain("Yorumlara göre tasarım ilerlemesi net.");
  });
});
