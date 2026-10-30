import { describe, expect, it } from "vitest";
import {
  formatCatererOrder,
  formatMealRoster,
  mealLine,
  catererWhatsappLink,
  orderedMeals,
  istanbulClock,
  managerMayEditClosedDay,
  mealDayWindow,
  mealDispatchDecision,
  orderableMealDates,
  orderWindow,
  reportRange,
  upcomingMealDates,

} from "@/server/meals/schedule";
import { planMenuRevision } from "@/server/meals/menuRevision";
import { parseAdileRows } from "@/server/meals/adileList";
import { resolveMealSelection } from "@/server/meals/selection";
import { inspectMealPhoto } from "@/server/meals/photos";

const schedule = {
  opensAt: "07:00",
  closesAt: "10:30",
  weekdays: [1, 2, 4],
};

describe("yemek listesinin gönderileceği gün", () => {
  const days = [1, 2, 4];

  it("yemek günü olmayan günde ve zamanı geçmiş kayıtta listeyi göndermez", () => {
    const friday = new Date("2026-10-30T06:40:00Z");
    expect(mealDispatchDecision(friday, friday, days).send).toBe(false);
    expect(mealDispatchDecision(friday, new Date("2026-10-22T08:05:00Z"), days)).toMatchObject({
      send: false,
      summary: "Zamanı geçmiş yemek kaydı gönderilmedi.",
    });
    expect(mealDispatchDecision(new Date("2026-10-29T08:05:00Z"), new Date("2026-10-29T08:05:00Z"), days).send).toBe(false);
    expect(mealDispatchDecision(new Date("2026-11-02T08:05:00Z"), new Date("2026-11-02T08:05:00Z"), days)).toMatchObject({
      send: true,
      date: "2026-11-02",
    });
  });
});

function at(iso) {
  return orderWindow(istanbulClock(new Date(iso)), schedule);
}

describe("yemek sipariş penceresi", () => {
  it("Pazartesi, Salı ve Perşembe günlerini kapanışa kadar açık sayar", () => {
    expect(at("2026-10-19T00:05:00+03:00").allowed).toBe(true);
    expect(at("2026-10-20T07:00:00+03:00").allowed).toBe(true);
    expect(at("2026-10-20T10:30:00+03:00").allowed).toBe(true);
    expect(at("2026-10-22T09:15:00+03:00").allowed).toBe(true);
  });

  it("kapanıştan sonra ve diğer günleri kapatır", () => {
    expect(at("2026-10-20T06:59:00+03:00").allowed).toBe(true);
    expect(at("2026-10-20T10:31:00+03:00").message).toMatch(/kapandı/);
    expect(at("2026-10-21T09:00:00+03:00").message).toMatch(/Pazartesi, Salı, Perşembe/);
    expect(at("2026-10-25T09:00:00+03:00").allowed).toBe(false);
  });

  it("sipariş verenlerin yemeğini ayırır ve WhatsApp bağlantısı kurar", () => {
    const people = orderedMeals([
      { name: "Emrah", meal: "İzmir köfte, Ezogelin" },
      { name: "Sena", meal: "Ofiste değil" },
      { name: "Misafir Ali", meal: "Mantı, Salata" },
    ]);
    expect(people.map((person) => person.name)).toEqual(["Emrah", "Misafir Ali"]);
    const text = formatMealRoster("2026-10-26", people);
    const link = catererWhatsappLink("0555 111 22 33", text);
    expect(link?.startsWith("https://wa.me/905551112233?text=")).toBe(true);
    expect(decodeURIComponent(link?.split("text=")[1] ?? "")).toContain("1) Emrah: İzmir köfte, Ezogelin");
    expect(decodeURIComponent(link?.split("text=")[1] ?? "")).toContain("Teşekkürler.");
    expect(link).not.toContain("Ofiste değil");
    expect(catererWhatsappLink("123", text)).toBeNull();
  });

  it("yemekçi metnini kişi ve yemek toplamıyla yazar, göndermez", () => {
    const text = formatCatererOrder("2026-10-20", [
      { name: "Tavuk", count: 2 },
      { name: "Corba", count: 1 },
    ]);
    expect(text).toContain("2026-10-20 Flywork yemek siparişi");
    expect(text).toContain("Tavuk: 2");
    expect(text).toContain("Corba: 1");
    expect(text).toContain("Toplam: 3");
    expect(text).toContain("yalnızca kopyalamak içindir");
    expect(text).not.toMatch(/telegram|http|gönderildi/i);
    const noted = formatCatererOrder("2026-10-20", [{ name: "Tavuk", count: 1 }], [
      { employeeName: "Ayşe", note: "az acı" },
    ]);
    expect(noted).toContain("Tavuk: 1");
    expect(noted).toContain("Notlar:\nAyşe: az acı");
    expect(noted).not.toMatch(/gönderildi/i);
  });

  it("yemekçi listesini numaralı sipariş metni olarak yazar", () => {
    const furkan = mealLine({
      item: { name: "BEĞENDİLİ MANGALDA KÖFTE" },
      soupItem: { name: "FIRINLANMIŞ MERCİMEK ÇORBASI" },
      sideItem: { name: "CACIK" },
    });
    const tunahan = mealLine({
      item: { name: "MANGALDA KÖFTE VE ŞEHRİYELİ PİRİNÇ PİLAVI" },
      soupItem: { name: "EZOGELİN ÇORBASI" },
    });
    expect(furkan).toBe("BEĞENDİLİ MANGALDA KÖFTE + FIRINLANMIŞ MERCİMEK ÇORBASI | Ekstra: CACIK");
    expect(tunahan).toBe("MANGALDA KÖFTE VE ŞEHRİYELİ PİRİNÇ PİLAVI + EZOGELİN ÇORBASI");
    const text = formatMealRoster("2026-10-22", [
      { name: "Tunahan Avşar", meal: tunahan },
      { name: "Sena", meal: "Ofiste değil" },
      { name: "Furkan Kazım Çam", meal: furkan, note: "Bol acılı" },
    ]);
    expect(text).toBe([
      "Merhaba, Flywork Ventures için 22.10.2026 siparişimiz (2 kişi):",
      "",
      "1) Tunahan Avşar: MANGALDA KÖFTE VE ŞEHRİYELİ PİRİNÇ PİLAVI + EZOGELİN ÇORBASI",
      "",
      "2) Furkan Kazım Çam: BEĞENDİLİ MANGALDA KÖFTE + FIRINLANMIŞ MERCİMEK ÇORBASI | Ekstra: CACIK | Not: Bol acılı",
      "",
      "Toplam: 2 kişilik yemek",
      "Teşekkürler.",
    ].join("\n"));
  });

  it("yan yana yazılan tavuk ve çorbaları tek menü fiyatında birleştirir", () => {
    const menu = parseAdileRows([
      { cells: ["ADİLE SULTAN USULÜ SEBZE ÇORBASI"] },
      { cells: ["EZOGELİN ÇORBASI"] },
      { cells: ["TAVUKLU YEMEKLER", "325 TL"] },
      { cells: ["BEĞENDİ YATAĞINDA MANGALDA TAVUK", "ADİLE SULTAN USULÜ SEBZE ÇORBASI"] },
      { cells: ["IZGARA TAVUK", "EZOGELİN ÇORBASI"] },
      { cells: ["ACI SOSLU TAVUK (+19,90)"] },
      { cells: ["BEĞENDİ YATAĞINDA HİNDİ TANDIR", "TÜM ÇORBALAR", "370 TL"] },
    ]);
    const beğendi = menu.dishes.find((dish) => dish.name.startsWith("BEĞENDİ YATAĞINDA MANGALDA"));
    const aci = menu.dishes.find((dish) => dish.name.startsWith("ACI SOSLU"));
    const soups = menu.dishes.filter((dish) => dish.slot === "SOUP" && dish.choiceKey === beğendi?.choiceKey);
    expect(beğendi).toMatchObject({ price: 325, slot: "MAIN" });
    expect(aci?.price).toBe(344.9);
    expect(soups.map((dish) => dish.name)).toEqual(expect.arrayContaining(["ADİLE SULTAN USULÜ SEBZE ÇORBASI", "EZOGELİN ÇORBASI"]));
    const hindi = menu.dishes.find((dish) => dish.name.includes("HİNDİ"));
    expect(hindi?.price).toBe(370);
    expect(menu.dishes.filter((dish) => dish.slot === "SOUP" && dish.choiceKey === hindi?.choiceKey).length).toBeGreaterThan(1);
  });

  it("menü fiyatındaki yemekte yalnız o grubun çorbasını ister", () => {
    const items = [
      { id: "tavuk", slot: "MAIN" , choiceKey: "tavuklu" },
      { id: "ezogelin", slot: "SOUP" , choiceKey: "tavuklu" },
      { id: "yayla", slot: "SOUP" , choiceKey: "baska" },
      { id: "pilav", slot: "SIDE" , choiceKey: "sebze" },
      { id: "sutlac", slot: "DESSERT" , choiceKey: "sutlac" },
    ];
    expect(resolveMealSelection(items, { mainItemId: "tavuk", soupItemId: "ezogelin" })).toMatchObject({
      ok: true,
      itemId: "tavuk",
      soupItemId: "ezogelin",
      sideItemId: null,
    });
    expect(resolveMealSelection(items, { mainItemId: "tavuk" }).ok).toBe(false);
    expect(resolveMealSelection(items, { mainItemId: "tavuk", soupItemId: "yayla" }).ok).toBe(false);
    expect(resolveMealSelection(items, { mainItemId: "tavuk", soupItemId: "ezogelin", dessertItemId: "sutlac" })).toMatchObject({
      ok: true,
      dessertItemId: "sutlac",
    });
  });

  it("kelle paça çorbasını menüye eklemez", () => {
    const menu = parseAdileRows([
      { cells: ["KELLE PAÇA ÇORBASI (ANTEP USULÜ)"] },
      { cells: ["EZOGELİN ÇORBASI"] },
      { cells: ["ETLİ YEMEKLER", "410 TL"] },
      { cells: ["KUZU GÜVEÇ", "TÜM ÇORBALAR"] },
      { cells: ["KELLE PAÇA ÇORBASI (ANTEP USULÜ)", "365 TL"] },
    ]);
    expect(menu.dishes.some((dish) => dish.name.includes("KELLE PAÇA"))).toBe(false);
    expect(menu.dishes.some((dish) => dish.name === "EZOGELİN ÇORBASI")).toBe(true);
  });

  it("ispir fasulyede pilav ya da çorba seçilir, pilav yalnız pirinç veya bulgurdur", () => {
    const menu = parseAdileRows([
      { cells: ["EZOGELİN ÇORBASI"] },
      { cells: ["SEBZELİ YEMEKLER"] },
      { cells: ["TEREYAĞLI İSPİR KURU FASULYE", "PİLAV veya ÇORBA", "365 TL"] },
    ]);
    const main = menu.dishes.find((dish) => dish.name.includes("İSPİR"));
    expect(main).toMatchObject({ price: 365, choiceKey: expect.stringMatching(/:or$/) });
    expect(menu.dishes.filter((dish) => dish.slot === "SIDE").map((dish) => dish.name)).toEqual(expect.arrayContaining(["BULGUR PİLAVI", "ŞEHRİYELİ PİRİNÇ PİLAVI"]));
    expect(menu.dishes.some((dish) => dish.name === "Pilav")).toBe(false);
    const key = main?.choiceKey.replace(/:or$/, "") ?? "";
    const items = [
      { id: "ispir", slot: "MAIN" , choiceKey: main?.choiceKey },
      { id: "ezogelin", slot: "SOUP" , choiceKey: key },
      { id: "bulgur", slot: "SIDE" , choiceKey: key },
      { id: "eriste", slot: "SIDE" , choiceKey: "sebzeli-yemekler" },
    ];
    expect(resolveMealSelection(items, { mainItemId: "ispir", soupItemId: "ezogelin" }).ok).toBe(true);
    expect(resolveMealSelection(items, { mainItemId: "ispir", sideItemId: "bulgur" }).ok).toBe(true);
    expect(resolveMealSelection(items, { mainItemId: "ispir", soupItemId: "ezogelin", sideItemId: "bulgur" }).ok).toBe(false);
    expect(resolveMealSelection(items, { mainItemId: "ispir" }).ok).toBe(false);
    expect(resolveMealSelection(items, { mainItemId: "ispir", sideItemId: "eriste" }).ok).toBe(false);
  });

  it("etli yemekte ve mantıda çorba ya da salata seçilir", () => {
    const menu = parseAdileRows([
      { cells: ["EZOGELİN ÇORBASI"] },
      { cells: ["ETLİ YEMEKLER", "425 TL"] },
      { cells: ["İZMİR KÖFTE", "TÜM ÇORBALAR veya SALATA"] },
      { cells: ["MANTILAR"] },
      { cells: ["ÖZBEK EV MANTISI + YOĞURT", "TÜM ÇORBALAR veya SALATA", "385 TL"] },
    ]);
    const kofte = menu.dishes.find((dish) => dish.name.includes("İZMİR"));
    const manti = menu.dishes.find((dish) => dish.name.includes("ÖZBEK"));
    expect(kofte?.choiceKey).toMatch(/:salad$/);
    expect(manti?.choiceKey).toMatch(/:salad$/);
    expect(menu.dishes.filter((dish) => dish.slot === "SIDE").map((dish) => dish.name)).toEqual(expect.arrayContaining(["Salata"]));
    const key = kofte?.choiceKey.replace(/:salad$/, "") ?? "";
    const items = [
      { id: "kofte", slot: "MAIN" , choiceKey: kofte?.choiceKey },
      { id: "ezogelin", slot: "SOUP" , choiceKey: key },
      { id: "salata", slot: "SIDE" , choiceKey: key },
      { id: "pilav", slot: "SIDE" , choiceKey: "sebzeli-yemekler" },
    ];
    expect(resolveMealSelection(items, { mainItemId: "kofte", soupItemId: "ezogelin" }).ok).toBe(true);
    expect(resolveMealSelection(items, { mainItemId: "kofte", sideItemId: "salata" }).ok).toBe(true);
    expect(resolveMealSelection(items, { mainItemId: "kofte", soupItemId: "ezogelin", sideItemId: "salata" }).ok).toBe(false);
    expect(resolveMealSelection(items, { mainItemId: "kofte" }).ok).toBe(false);
    expect(resolveMealSelection(items, { mainItemId: "kofte", sideItemId: "pilav" }).ok).toBe(false);
  });

  it("etli sebzelide çorba ve salata ya da cacık, mercimekte çorba ya da salata seçilir", () => {
    const menu = parseAdileRows([
      { cells: ["EZOGELİN ÇORBASI"] },
      { cells: ["ETLİ SEBZELİ YEMEKLER", "400 TL"] },
      { cells: ["ETLİ BİBER DOLMA", "TÜM ÇORBALAR SALATA veya Cacık"] },
      { cells: ["KIYMALI YEŞİL MERCİMEK", "TÜM ÇORBALAR veya SALATA", "360 TL"] },
      { cells: ["PATATES OTURTMA"] },
    ]);
    const dolma = menu.dishes.find((dish) => dish.name.includes("BİBER"));
    const mercimek = menu.dishes.find((dish) => dish.name.includes("MERCİMEK") && dish.slot === "MAIN");
    const oturtma = menu.dishes.find((dish) => dish.name.includes("OTURTMA"));
    expect(dolma?.choiceKey).toBe("etli-sebzeli-yemekler");
    expect(mercimek?.choiceKey).toMatch(/:salad$/);
    expect(oturtma?.choiceKey).toBe(mercimek?.choiceKey);
    const dolmaKey = dolma?.choiceKey ?? "";
    const mercimekKey = mercimek?.choiceKey?.replace(/:salad$/, "") ?? "";
    const items = [
      { id: "dolma", slot: "MAIN" , choiceKey: dolma?.choiceKey },
      { id: "mercimek", slot: "MAIN" , choiceKey: mercimek?.choiceKey },
      { id: "ezogelin", slot: "SOUP" , choiceKey: `${dolmaKey}|${mercimekKey}` },
      { id: "salata", slot: "SIDE" , choiceKey: `${dolmaKey}|${mercimekKey}` },
      { id: "cacik", slot: "SIDE" , choiceKey: dolmaKey },
    ];
    expect(resolveMealSelection(items, { mainItemId: "dolma", soupItemId: "ezogelin", sideItemId: "salata" }).ok).toBe(true);
    expect(resolveMealSelection(items, { mainItemId: "dolma", soupItemId: "ezogelin", sideItemId: "cacik" }).ok).toBe(true);
    expect(resolveMealSelection(items, { mainItemId: "dolma", soupItemId: "ezogelin" }).ok).toBe(false);
    expect(resolveMealSelection(items, { mainItemId: "dolma", sideItemId: "salata" }).ok).toBe(false);
    expect(resolveMealSelection(items, { mainItemId: "mercimek", soupItemId: "ezogelin" }).ok).toBe(true);
    expect(resolveMealSelection(items, { mainItemId: "mercimek", sideItemId: "salata" }).ok).toBe(true);
    expect(resolveMealSelection(items, { mainItemId: "mercimek", soupItemId: "ezogelin", sideItemId: "salata" }).ok).toBe(false);
    expect(resolveMealSelection(items, { mainItemId: "mercimek", sideItemId: "cacik" }).ok).toBe(false);
  });

  it("yaklaşan altı yemek gününü pazartesi, salı ve perşembeden seçer", () => {
    expect(upcomingMealDates("2026-10-22", [1, 2, 4], 6)).toEqual([
      "2026-10-22",
      "2026-10-26",
      "2026-10-27",
      "2026-10-29",
      "2026-11-02",
      "2026-11-03",
    ]);
  });

  it("bugünü 10:30'a kadar, sonraki yemek günlerini önceden açık tutar", () => {
    const now = new Date("2026-10-22T09:00:00+03:00");
    expect(mealDayWindow("2026-10-26", now, schedule).allowed).toBe(true);
    expect(mealDayWindow("2026-10-29", now, schedule)).toMatchObject({ allowed: false, message: "Resmi tatil." });
    expect(mealDayWindow("2026-10-22", new Date("2026-10-22T00:05:00+03:00"), schedule).allowed).toBe(true);
    expect(mealDayWindow("2026-10-22", new Date("2026-10-22T10:30:00+03:00"), schedule).allowed).toBe(true);
    expect(mealDayWindow("2026-10-22", new Date("2026-10-22T10:31:00+03:00"), schedule).allowed).toBe(false);
    expect(mealDayWindow("2026-10-21", now, schedule).allowed).toBe(false);
    expect(mealDayWindow("2026-12-01", now, schedule).allowed).toBe(false);
  });

  it("kapanıştan sonra bugünü çıkarıp sıradaki yemek gününü ekler", () => {
    const open = { ...schedule, closesAt: "11:00" };
    const morning = new Date("2026-10-26T10:59:00+03:00");
    const closed = new Date("2026-10-26T11:01:00+03:00");
    expect(orderableMealDates(morning, open, 6)).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-29",
      "2026-11-02",
      "2026-11-03",
      "2026-11-05",
    ]);
    expect(orderableMealDates(new Date("2026-10-26T11:00:00+03:00"), open, 6)[0]).toBe("2026-10-26");
    expect(orderableMealDates(closed, open, 6)).toEqual([
      "2026-10-27",
      "2026-10-29",
      "2026-11-02",
      "2026-11-03",
      "2026-11-05",
      "2026-11-09",
    ]);
    expect(mealDayWindow("2026-10-26", closed, open)).toMatchObject({ allowed: false, message: expect.stringMatching(/kapandı/) });
    expect(mealDayWindow("2026-10-27", closed, open)).toMatchObject({
      allowed: true,
      message: expect.stringMatching(/27\.10 siparişi saat 11:00'e kadar değiştirilebilir/),
    });
    expect(mealDayWindow("2026-11-09", closed, open).allowed).toBe(true);
    expect(mealDayWindow("2026-11-10", closed, open).allowed).toBe(false);
    expect(managerMayEditClosedDay("2026-10-26", closed, open)).toBe(true);
    expect(managerMayEditClosedDay("2026-10-26", new Date("2026-10-26T10:30:00+03:00"), open)).toBe(false);
    expect(managerMayEditClosedDay("2026-10-27", closed, open)).toBe(false);
    expect(managerMayEditClosedDay("2026-10-29", new Date("2026-10-29T12:00:00+03:00"), open)).toBe(false);
  });

  it("katalog menüsünde üç ayrı seçim, ofiste olmama ve mükerrer ürünü doğrular", () => {
    const items = [
      { id: "ana", slot: "MAIN"  },
      { id: "corba", slot: "SOUP"  },
      { id: "pilav", slot: "SIDE"  },
    ];
    expect(resolveMealSelection(items, { mainItemId: "ana", soupItemId: "corba", sideItemId: "pilav" })).toMatchObject({
      ok: true,
      itemId: "ana",
      soupItemId: "corba",
      sideItemId: "pilav",
    });
    expect(resolveMealSelection(items, { mainItemId: "ana" }).ok).toBe(false);
    expect(resolveMealSelection(items, { mainItemId: "ana", soupItemId: "ana", sideItemId: "pilav" }).ok).toBe(false);
    expect(resolveMealSelection(items, { absent: true, note: "dışarıda" })).toMatchObject({
      ok: true,
      absent: true,
      itemId: null,
      note: "dışarıda",
    });
    expect(resolveMealSelection([{ id: "tabak", slot: null }], { itemId: "tabak" })).toMatchObject({
      ok: true,
      itemId: "tabak",
    });
    const withDessert = [
      ...items,
      { id: "sutlac", slot: "DESSERT"  },
    ];
    expect(resolveMealSelection(withDessert, { mainItemId: "ana", soupItemId: "corba", sideItemId: "pilav" })).toMatchObject({
      ok: true,
      dessertItemId: null,
    });
    expect(
      resolveMealSelection(withDessert, {
        mainItemId: "ana",
        soupItemId: "corba",
        sideItemId: "pilav",
        dessertItemId: "sutlac",
      }),
    ).toMatchObject({ ok: true, dessertItemId: "sutlac" });
    expect(
      resolveMealSelection(withDessert, {
        mainItemId: "ana",
        soupItemId: "corba",
        sideItemId: "pilav",
        dessertItemId: "ana",
      }).ok,
    ).toBe(false);
    const removed = [{ id: "ana", slot: "MAIN" , available: false }, ...items.slice(1)];
    expect(resolveMealSelection(removed, { mainItemId: "ana", soupItemId: "corba", sideItemId: "pilav" })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/menüden çıkarıldı/i),
    });
  });

  it("menüden çıkan seçimi yerinde tutar ve başka yemeğe taşımaz", () => {
    const plan = planMenuRevision(
      [
        { id: "item-ana", dishId: "ana", name: "Kuru Fasulye" },
        { id: "item-corba", dishId: "corba", name: "Mercimek" },
        { id: "item-pilav", dishId: "pilav", name: "Pirinç" },
      ],
      ["ana-2", "corba", "pilav"],
      [
        {
          id: "siparis",
          employeeName: "Ayşe",
          absent: false,
          choices: [
            { slotLabel: "Ana yemek", itemId: "item-ana" },
            { slotLabel: "Çorba", itemId: "item-corba" },
            { slotLabel: "Pilav / garnitür", itemId: "item-pilav" },
            { slotLabel: "Tatlı", itemId: null },
          ],
        },
      ],
    );
    expect(plan.creates).toEqual([{ dishId: "ana-2", sortOrder: 0 }]);
    expect(plan.unavailableIds).toEqual(["item-ana"]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.conflicts).toEqual([
      { orderId: "siparis", employeeName: "Ayşe", itemName: "Kuru Fasulye", slotLabel: "Ana yemek" },
    ]);
    expect(plan.updates.map((item) => item.itemId)).toEqual(["item-corba", "item-pilav"]);
  });

  it("yemek fotoğrafı yalnızca jpeg, png ve webp kabul eder", () => {
    expect(() => inspectMealPhoto({ bytes: Buffer.from("yazı"), contentType: "text/plain" })).toThrow(/JPEG/);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    expect(inspectMealPhoto({ bytes: png, contentType: "application/octet-stream" }).contentType).toBe("image/png");
  });

  it("günlük, haftalık ve aylık aralığı hesaplar", () => {
    expect(reportRange("day", "2026-10-20")).toEqual({
      from: "2026-10-20",
      to: "2026-10-20",
    });
    expect(reportRange("week", "2026-10-22")).toEqual({
      from: "2026-10-19",
      to: "2026-10-25",
    });
    expect(reportRange("month", "2026-10-22")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });
});
