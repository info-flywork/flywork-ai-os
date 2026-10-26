import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(panel)/yemek-yonetimi/actions", () => ({
  publishCatalogAction: vi.fn(),
  saveOrderAction: vi.fn(),
}));

import EmployeeMeal from "@/components/meals/EmployeeMeal";
import { mealTab } from "@/components/meals/MealTabs";
import MenuPlanner from "@/components/meals/MenuPlanner";

const catalog = [
  {
    id: "cat-etli",
    name: "Etli Yemekler",
    dishes: [
      {
        id: "kofte",
        name: "Izgara Köfte",
        slot: "MAIN",
        active: true,
        priceLabel: null,
        description: null,
        photoUrl: null,
      },
    ],
  },
  {
    id: "cat-yan",
    name: "Yan Ürünler",
    dishes: [
      {
        id: "mercimek",
        name: "Mercimek Çorbası",
        slot: "SOUP",
        active: true,
        priceLabel: "19,90 TL",
        description: "Süzme",
        photoUrl: null,
      },
    ],
  },
];

describe("günlük menü ekranları", () => {
  afterEach(() => {
    cleanup();
  });

  it("katalogda arar, ekler, çıkarır ve yayınla düğmesini seçimden önce kapalı tutar", () => {
    render(<MenuPlanner date="2026-10-26" editable menu={null} catalog={catalog} />);
    const draft = screen.getByRole("button", { name: "Taslak kaydet" }) as HTMLButtonElement;
    const publish = screen.getByRole("button", { name: "Yayınla" }) as HTMLButtonElement;
    expect(draft.disabled).toBe(true);
    expect(draft.value).toBe("taslak");
    expect(publish.disabled).toBe(true);
    expect(publish.value).toBe("yayin");

    fireEvent.click(screen.getByRole("button", { name: /Izgara Köfte/ }));
    expect(screen.getByRole("button", { name: "Çıkar" })).toBeTruthy();
    expect(publish.disabled).toBe(false);
    expect(document.querySelector('input[name="dishIds"]')?.getAttribute("value")).toBe("kofte");

    fireEvent.change(screen.getByLabelText("Yemek ara"), { target: { value: "mercimek" } });
    expect(screen.queryByRole("button", { name: /Izgara Köfte/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Mercimek Çorbası/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Etli Yemekler" }));
    expect(screen.getByText("Bu süzgeçte yemek yok.")).toBeTruthy();
  });

  it("çalışan kartında yer tutucu, fiyat, açıklama ve anlık özeti gösterir", () => {
    render(
      <EmployeeMeal
        today="2026-10-26"
        days={[
          {
            date: "2026-10-26",
            open: true,
            message: "Bugün için sipariş önceden kaydedilebilir.",
            order: null,
            menu: {
              id: "menu-1",
              date: "2026-10-26",
              note: null,
              items: [
                { id: "ana", name: "Izgara Köfte", slot: "MAIN", available: true, categoryName: "Etli Yemekler", photoUrl: null, priceLabel: null, description: null },
                { id: "tavuk", name: "Mangalda Tavuk", slot: "MAIN", available: true, categoryName: "Etli Yemekler", photoUrl: null, priceLabel: null, description: null },
                { id: "corba", name: "Mercimek Çorbası", slot: "SOUP", available: true, categoryName: "Çorbalar", photoUrl: null, description: null },
                { id: "ezogelin", name: "Ezogelin Çorbası", slot: "SOUP", available: true, categoryName: "Çorbalar", photoUrl: null, description: null },
                { id: "pilav", name: "Pirinç Pilavı", slot: "SIDE", available: true, categoryName: "Pilav Üstü", photoUrl: null, priceLabel: null, description: null },
                { id: "tatli", name: "Sütlaç", slot: "DESSERT", available: true, categoryName: "Tatlılar", photoUrl: null, priceLabel: null, description: null },
              ],
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Henüz seçim yapmadın.")).toBeTruthy();
    fireEvent.click(screen.getByText("Izgara Köfte"));
    fireEvent.click(screen.getByText("Mangalda Tavuk"));
    fireEvent.click(screen.getByText("Mercimek Çorbası"));
    fireEvent.click(screen.getByText("Ezogelin Çorbası"));
    const summary = document.querySelector("aside");
    expect(summary?.textContent).toContain("Mangalda Tavuk");
    expect(summary?.textContent).toContain("Ana yemek");
    expect(summary?.textContent).not.toContain("Izgara Köfte");
    expect(summary?.textContent).toContain("Ezogelin Çorbası");
    expect(summary?.textContent).toContain("Menü seçimi");
    expect(summary?.textContent).not.toContain("Mercimek Çorbası");
    fireEvent.click(screen.getByRole("button", { name: "Ezogelin Çorbası kaldır" }));
    expect(summary?.textContent).not.toContain("Ezogelin Çorbası");
    expect(summary?.textContent).toContain("Mangalda Tavuk");
  });

  it("sipariş ekranında fiyat göstermez ve çalışanı sipariş sekmesinde tutar", () => {
    render(
      <EmployeeMeal
        today="2026-10-26"
        days={[
          {
            date: "2026-10-26",
            open: true,
            message: "Açık",
            order: null,
            menu: {
              id: "menu-1",
              date: "2026-10-26",
              note: null,
              items: [
                { id: "corba", name: "Mercimek Çorbası (+19,90)", slot: "SOUP", available: true, categoryName: "Yan Ürünler", photoUrl: null, description: null },
              ],
            },
          },
        ]}
      />,
    );
    expect(screen.getByText("Mercimek Çorbası")).toBeTruthy();
    expect(screen.queryByText(/19,90/)).toBeNull();
    expect(screen.queryByText("Siparişlerim")).toBeNull();
    expect(screen.queryByText("Günlük")).toBeNull();
    expect(screen.queryByText("Aylık")).toBeNull();
    expect(mealTab("gunluk", "EMPLOYEE")).toBe("siparis");
    expect(mealTab("aylik", "ADMIN")).toBe("aylik");
    expect(mealTab("siparislerim", "EMPLOYEE")).toBe("siparis");
  });
});
