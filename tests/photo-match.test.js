import { describe, expect, it } from "vitest";
import { adilePhotoRows, adilePhotoSummary } from "@/server/meals/adilePhotoReport";
import { planDishPhotoLinks } from "@/server/meals/photoLink";
import { buildPhotoReview, photoPublishBlock } from "@/server/meals/photoMatch";

const png = "https://adilesultan.restapp.com/uploads/95539/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
const jpg = "https://adilesultan.restapp.com/uploads/95539/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg";
const other = "https://adilesultan.restapp.com/uploads/95539/cccccccccccccccccccccccccccccccc.jpg";

function product(name, imageUrl) {
  return {
    name,
    category: "Deneme",
    pageUrl: "https://siparis.adilesultanevyemekleri.com/product/deneme-yemek",
    imageUrl,
  };
}

describe("yemek fotoğrafı eşleştirme", () => {
  it("yalnızca birebir adı kesin sayar", () => {
    const rows = buildPhotoReview(
      ["KURU FASULYE", "TEREYAĞLI İSPİR KURU FASULYE", "DUBLE IZGARA TAVUK"],
      [
        product("Kuru Fasulye", png),
        product("Tereyağlı İspir Kuru Fasulye", jpg),
        product("Izgara Tavuk", other),
      ],
    );
    expect(rows.map((row) => row.status)).toEqual(["kesin", "kesin", "yok"]);
    expect(rows[2]?.candidates).toEqual([]);
  });

  it("ortak görseli, porsiyonu, yoğurdu ve yazım farkını kesin saymaz", () => {
    const shared = "https://adilesultan.restapp.com/uploads/95539/dddddddddddddddddddddddddddddddd.jpg";
    const rows = buildPhotoReview(
      [
        "HUMUSLU MİNİ İÇLİ KÖFTE (3 ADET)",
        "PATATESLİ MİNİ İÇLİ KÖFTE (3 ADET)",
        "ADİLE SULTAN USULÜ ETLİ YAPRAK SARMA",
        "ÖZBEK EV MANTISI + YOĞURT",
        "ADİLE SULTA USULÜ ZEYTİNYAĞLI YAPRAK SARMA (5 ADET)",
      ],
      [
        product("Humuslu Mini İçli Köfte (3 adet)", shared),
        product("Patatesli Mini İçli Köfte (3 adet)", shared),
        product("Adile Sultan Usulü Etli Yaprak Sarma (7 Adet)", png),
        product("Adile Sultan Usulü Etli Yaprak Sarma (10 Adet)", jpg),
        product("Özbek Ev Mantısı", other),
        product("Adile Sultan Usulü Zeytinyağlı Yaprak Sarma (5 Adet)", "https://adilesultan.restapp.com/uploads/95539/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.webp"),
      ],
    );
    expect(rows.map((row) => row.status)).toEqual(["manuel", "manuel", "manuel", "manuel", "manuel"]);
    expect(rows[0]?.sharedImage).toBe(true);
    expect(rows[2]?.candidates).toHaveLength(2);
    expect(rows[4]?.reason).toMatch(/yazım/);
  });

  it("Adile Sultan listesinin tamamını sınıflar", () => {
    const rows = adilePhotoRows();
    const summary = adilePhotoSummary(rows);
    expect(summary).toMatchObject({ examined: 118, images: 133, products: 134, kesin: 103, manuel: 6, missing: 9, rightsVerified: false });
    expect(rows.find((row) => row.dishName === "KURU FASULYE")?.status).toBe("kesin");
    expect(rows.find((row) => row.dishName === "KABAK TATLISI")?.status).toBe("yok");
    expect(rows.find((row) => row.dishName === "IZGARA KÖFTE VE BUHARDA SEBZELER")?.candidates).toEqual([]);
    expect(rows.find((row) => row.dishName === "KIYMALI YEŞİL MERCİMEK")?.status).toBe("yok");
  });

  it("kesin eşleşmeyi yemek kimliğine ayırır", () => {
    const rows = adilePhotoRows();
    const dishes = rows.map((row, index) => ({ id: `id-${index + 1}`, name: row.dishName }));
    const plan = planDishPhotoLinks(dishes);
    expect(plan.rightsVerified).toBe(false);
    expect(plan.confirmed).toHaveLength(103);
    expect(plan.manual).toHaveLength(6);
    expect(plan.missing).toHaveLength(9);
    const ids = [...plan.confirmed, ...plan.manual, ...plan.missing].map((item) => item.dishId);
    expect(new Set(ids).size).toBe(118);
    expect(plan.confirmed.every((item) => item.list === "CONFIRMED" && item.rightsVerified === false && item.sources.length === 1)).toBe(true);
    expect(plan.confirmed.every((item) => item.imageUrl?.startsWith("https://adilesultan.restapp.com/"))).toBe(true);
    expect(plan.manual.every((item) => item.list === "MANUAL" && item.rightsVerified === false)).toBe(true);
    expect(plan.missing.every((item) => item.list === "MISSING" && item.sources.length === 0 && item.imageUrl === null)).toBe(true);
    const kabak = dishes.find((dish) => dish.name === "KABAK TATLISI");
    expect(plan.missing.some((item) => item.dishId === kabak?.id)).toBe(true);
    expect(plan.confirmed.some((item) => item.dishId === kabak?.id)).toBe(false);
    expect(() => planDishPhotoLinks([
      { id: "a", name: "KURU FASULYE" },
      { id: "b", name: "Kuru Fasulye" },
    ])).toThrow(/iki yemek/);
    expect(planDishPhotoLinks([{ id: "x", name: "Faz4 Olmayan Yemek" }])).toMatchObject({
      confirmed: [],
      manual: [],
      missing: [],
    });
  });

  it("onay ve kullanım hakkı birlikte olmadan yayını kapalı tutar", () => {
    expect(photoPublishBlock({ rightsVerified: false, decision: null, candidateCount: 1, sharedImage: false })).toMatch(/onayı/);
    expect(photoPublishBlock({ rightsVerified: false, decision: "APPROVED", candidateCount: 1, sharedImage: false })).toMatch(/Kullanım hakkı/);
    expect(photoPublishBlock({ rightsVerified: true, decision: "APPROVED", candidateCount: 2, sharedImage: false })).toMatch(/Tek görsel/);
    expect(photoPublishBlock({ rightsVerified: true, decision: "APPROVED", candidateCount: 1, sharedImage: true })).toMatch(/başka yemekte/);
    expect(photoPublishBlock({ rightsVerified: true, decision: "APPROVED", candidateCount: 1, sharedImage: false })).toBeNull();
  });
});
