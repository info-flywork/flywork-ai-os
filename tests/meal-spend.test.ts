import { describe, expect, it } from "vitest";
import {
  daySpend,
  formatKurus,
  monthSpend,
  pendingDiners,
  spendLabel,
} from "@/server/meals/spend";

describe("yemek gideri", () => {
  it("kayıtlı fiyatları toplar ve eksik fiyatı sıfır gibi göstermez", () => {
    const complete = daySpend([
      {
        kind: "employee",
        personName: "Ayşe",
        absent: false,
        status: "RECEIVED",
        choices: [
          { name: "Ana", price: "19.9" },
          { name: "Pilav", price: "5.00" },
        ],
      },
    ]);
    expect(complete.missing).toBe(false);
    expect(complete.totalKurus).toBe(2490);
    expect(formatKurus(complete.totalKurus ?? 0)).toBe("24,90 TL");
    expect(formatKurus(211980)).toBe("2.119,80 TL");

    const incomplete = daySpend([
      {
        kind: "employee",
        personName: "Ali",
        absent: false,
        status: "RECEIVED",
        choices: [{ name: "Çorba", price: null }],
      },
    ]);
    expect(incomplete.missing).toBe(true);
    expect(incomplete.totalKurus).toBeNull();
    expect(spendLabel(incomplete.totalKurus, incomplete.missing)).toBe("Toplam hesaplanamıyor");
    expect(monthSpend([complete, incomplete]).totalKurus).toBeNull();
  });

  it("ofiste olmayanı sipariş vermeyenlerden ayırır", () => {
    const result = pendingDiners(
      [
        { id: "a", name: "Ayşe" },
        { id: "b", name: "Ali" },
      ],
      [{ userId: "a", absent: true, status: "RECEIVED" }],
    );
    expect(result.away.map((person) => person.name)).toEqual(["Ayşe"]);
    expect(result.pending.map((person) => person.name)).toEqual(["Ali"]);
  });
});
