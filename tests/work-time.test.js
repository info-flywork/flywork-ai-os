import { describe, expect, it } from "vitest";
import { dayReport, formatWorkDuration, pauseGapMillis } from "@/lib/workTime";

const people = [
  { userId: "emrah", name: "Emrah" },
  { userId: "sena", name: "Sena" },
];

function at(iso) {
  return Date.parse(`${iso}.000Z`);
}

describe("günlük çalışma süresi", () => {
  it("aynı gündeki işi saat ve süre olarak ayırır", () => {
    const report = dayReport(people, [
      { userId: "emrah", taskId: "a", title: "Aulix", start: at("2026-10-30T06:00:00"), stop: at("2026-10-30T08:30:00"), pausedMs: 0 },
    ], "2026-10-30", new Date("2026-10-30T12:00:00Z"));
    expect(report[0].minutes).toBe(150);
    expect(report[0].stints[0]).toMatchObject({ title: "Aulix", from: "09:00", to: "11:30" });
    expect(formatWorkDuration(report[0].minutes)).toBe("2 sa 30 dk");
    expect(report[1].stints).toEqual([]);
  });

  it("molayı süreden düşer ve gece yarısını günlere böler", () => {
    const report = dayReport(people, [
      { userId: "sena", taskId: "b", title: "Veylo", start: at("2026-10-29T20:00:00"), stop: at("2026-10-29T23:00:00"), pausedMs: 30 * 60 * 1000 },
    ], "2026-10-30", new Date("2026-10-30T12:00:00Z"));
    expect(report[1].minutes).toBe(90);
    expect(report[1].stints[0]).toMatchObject({ from: "00:00", to: "01:30" });
    const previous = dayReport(people, [
      { userId: "sena", taskId: "b", title: "Veylo", start: at("2026-10-29T20:00:00"), stop: at("2026-10-29T23:00:00"), pausedMs: 30 * 60 * 1000 },
    ], "2026-10-29", new Date("2026-10-30T12:00:00Z"));
    expect(previous[1].minutes).toBe(60);
  });

  it("açık işi bugüne kadar sayar, duraklatılmış işi durduğu yerde keser", () => {
    const now = new Date("2026-10-30T07:30:00Z");
    const report = dayReport(people, [
      { userId: "emrah", taskId: "a", title: "Açık", start: at("2026-10-30T06:00:00"), stop: null, pausedMs: 0 },
      { userId: "sena", taskId: "b", title: "Mola", start: at("2026-10-30T06:00:00"), stop: at("2026-10-30T07:00:00"), pausedMs: 0 },
    ], "2026-10-30", now);
    expect(report[0].running).toBe(true);
    expect(report[0].minutes).toBe(90);
    expect(report[1].running).toBe(false);
    expect(report[1].minutes).toBe(60);
  });

  it("mola aralığını geçen süre olarak ölçer", () => {
    const pausedAt = new Date(at("2026-10-30T07:00:00"));
    const now = new Date("2026-10-30T07:20:00Z");
    expect(pauseGapMillis(pausedAt, now)).toBe(20 * 60 * 1000);
    expect(pauseGapMillis(null, now)).toBe(0);
  });
});
