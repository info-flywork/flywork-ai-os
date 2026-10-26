import { describe, expect, it } from "vitest";
import { addIsoDays, istanbulClock } from "@/server/meals/schedule";
import { computeLeave, LeaveCalcError } from "@/server/leave/duration";
import { annualAllocationForYear } from "@/server/leave/entitlement";

const openCalendar = {
  hoursPerDay: 8,
  weekendDays: [],
  holidays: [],
};

function mondayOnOrAfter(start) {
  let date = start;
  while (istanbulClock(new Date(`${date}T12:00:00+03:00`)).weekday !== 1) {
    date = addIsoDays(date, 1);
  }
  return date;
}

describe("izin süresi", () => {
  it("hafta sonu tanımlı değilken aralıktaki her günü sayar", () => {
    const monday = mondayOnOrAfter("2099-06-01");
    const sunday = addIsoDays(monday, 6);
    const result = computeLeave(
      { duration: "MULTI_DAY", startDate: monday, endDate: sunday },
      openCalendar,
    );
    expect(result.dayCount).toBe("7.00");
    expect(result.workingDates).toHaveLength(7);
  });

  it("yalnızca tanımlı hafta sonu ve tatilleri düşer", () => {
    const monday = mondayOnOrAfter("2099-06-01");
    const sunday = addIsoDays(monday, 6);
    const wednesday = addIsoDays(monday, 2);
    const calendar = {
      hoursPerDay: 8,
      weekendDays: [6, 7],
      holidays: [wednesday],
    };
    const result = computeLeave(
      { duration: "MULTI_DAY", startDate: monday, endDate: sunday },
      calendar,
    );
    expect(result.dayCount).toBe("4.00");
    expect(result.workingDates).not.toContain(wednesday);
    expect(result.workingDates).not.toContain(addIsoDays(monday, 5));
  });

  it("saatlik izni iş günü süresine böler", () => {
    const result = computeLeave(
      {
        duration: "HOURLY",
        startDate: "2099-06-02",
        endDate: "2099-06-02",
        startTime: "09:00",
        endTime: "13:00",
      },
      openCalendar,
    );
    expect(result.hourCount).toBe("4.00");
    expect(result.dayCount).toBe("0.50");
    expect(result.endsAt.toISOString()).toBe("2099-06-02T10:00:00.000Z");
  });

  it("boş çalışma aralığını ve yıl dışına taşmayı reddeder", () => {
    let saturday = "2099-06-01";
    while (istanbulClock(new Date(`${saturday}T12:00:00+03:00`)).weekday !== 6) {
      saturday = addIsoDays(saturday, 1);
    }
    expect(() =>
      computeLeave(
        { duration: "FULL_DAY", startDate: saturday, endDate: saturday },
        { hoursPerDay: 8, weekendDays: [6], holidays: [] },
      ),
    ).toThrow(LeaveCalcError);

    expect(() =>
      computeLeave(
        { duration: "MULTI_DAY", startDate: "2099-12-30", endDate: "2100-01-02" },
        openCalendar,
      ),
    ).toThrow(/aynı takvim yılı/);
  });
});

describe("yıllık izin hakkı", () => {
  const today = "2026-10-23";

  it("bir yıl dolunca seçilen yıl için 14 gün tanımlar", () => {
    expect(annualAllocationForYear("2025-10-01", 2026, today)).toBe("14.00");
    expect(annualAllocationForYear("2025-10-13", 2026, today)).toBe("14.00");
    expect(annualAllocationForYear("2026-01-01", 2026, today)).toBeNull();
    expect(annualAllocationForYear("2026-07-01", 2026, today)).toBeNull();
  });

  it("hak doğmadan önceki yılda ve gelecekteki yılda bakiye açmaz", () => {
    expect(annualAllocationForYear("2025-10-01", 2025, today)).toBeNull();
    expect(annualAllocationForYear("2025-10-01", 2027, today)).toBeNull();
    expect(annualAllocationForYear("2026-01-01", 2027, "2027-01-01")).toBe("14.00");
    expect(annualAllocationForYear("2026-07-01", 2027, "2027-01-01")).toBeNull();
  });
});
