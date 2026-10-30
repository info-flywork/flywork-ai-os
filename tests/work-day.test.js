import { describe, expect, it } from "vitest";
import { visibleWorkDay, workDayView } from "@/server/work/day";

describe("günün iş şeridi", () => {
  it("açık işi şu an, bugün kapananı bugün listesine koyar", () => {
    const morning = new Date(Date.UTC(2026, 9, 29, 5, 20));
    const later = new Date(Date.UTC(2026, 9, 29, 6, 5));
    const view = workDayView([
      { id: "open", endedAt: null, startedAt: morning, userName: "Tunahan", title: "Date AI", done: false },
      { id: "done", endedAt: later, startedAt: morning, userName: "Sena", title: "İvme", done: true },
      { id: "old", endedAt: new Date(Date.UTC(2026, 9, 28, 6, 0)), startedAt: new Date(Date.UTC(2026, 9, 28, 5, 0)), userName: "Emrah", title: "Eski", done: true },
    ], "2026-10-29");
    expect(view.now.map((item) => item.id)).toEqual(["open"]);
    expect(view.now[0].startedLabel).toBe("08:20");
    expect(view.earlier.map((item) => item.id)).toEqual(["done"]);
    expect(view.earlier[0].endedLabel).toBe("09:05");
    expect(view.log.map((item) => [item.id, item.day])).toEqual([["done", "2026-10-29"], ["old", "2026-10-28"]]);
  });

  it("durdurulan işi şu andan ayırır", () => {
    const started = new Date(Date.UTC(2026, 9, 29, 7, 0));
    const pausedAt = new Date(Date.UTC(2026, 9, 29, 7, 40));
    const view = workDayView([
      { id: "held", endedAt: null, pausedAt, startedAt: started, userName: "Emrah", title: "Femia", done: false },
    ], "2026-10-29");
    expect(view.now).toEqual([]);
    expect(view.paused.map((item) => item.id)).toEqual(["held"]);
    expect(view.paused[0].pausedLabel).toBe("10:40");
  });

  it("yönetici çalışanları görür, çalışan yalnız kendi satırını görür", () => {
    const people = [
      { id: "tunahan", name: "Tunahan Avşar", role: "ADMIN" },
      { id: "anil", name: "Anıl Can Mayancur", role: "ADMIN" },
      { id: "emrah", name: "Emrah Doğan", role: "EMPLOYEE" },
      { id: "sena", name: "Sena Özyiğit", role: "EMPLOYEE" },
      { id: "furkan", name: "Furkan Kazım Çam", role: "EMPLOYEE" },
    ];
    const day = {
      now: [
        { id: "sena-now", userId: "sena", userName: "Sena Özyiğit", title: "İvme" },
        { id: "boss", userId: "tunahan", userName: "Tunahan Avşar", title: "Date AI" },
      ],
      paused: [
        { id: "furkan-held", userId: "furkan", userName: "Furkan Kazım Çam", title: "Skincare" },
      ],
      earlier: [
        { id: "emrah-done", userId: "emrah", userName: "Emrah Doğan", title: "Femia" },
        { id: "boss-done", userId: "tunahan", userName: "Tunahan Avşar", title: "Deneme" },
      ],
    };
    const admin = visibleWorkDay({ id: "tunahan", role: "ADMIN" }, people, day);
    expect(admin.team).toBe(true);
    expect(admin.roster.map((person) => person.userName)).toEqual(["Emrah Doğan", "Furkan Kazım Çam", "Sena Özyiğit"]);
    expect(admin.roster.find((person) => person.userId === "sena").current.title).toBe("İvme");
    expect(admin.roster.find((person) => person.userId === "furkan").current).toBeNull();
    expect(admin.roster.find((person) => person.userId === "furkan").paused.title).toBe("Skincare");
    expect(admin.paused.map((item) => item.id)).toEqual(["furkan-held"]);
    expect(admin.earlier.map((item) => item.id)).toEqual(["emrah-done"]);
    const employee = visibleWorkDay({ id: "emrah", role: "EMPLOYEE" }, people, day);
    expect(employee.roster).toEqual([]);
    expect(employee.earlier.map((item) => item.id)).toEqual(["emrah-done"]);
    expect(employee.now.map((item) => item.id)).toEqual(["sena-now"]);
  });
});
