import { describe, expect, it } from "vitest";
import { sourceFromBrowserFiles } from "@/components/meals/catalogSelection";
import { buildCatalogSource } from "@/server/meals/catalogSource";
import {
  CATALOG_IMPORT_TEMPLATE,
  buildCatalogPlan,
  formatCatalogPreviewSummary,
  parseCatalogDocument,
  parseCatalogPrice,
  photoReference,
  previewMatchesSource,
  toCatalogPreview,
} from "@/server/meals/importCatalog";

const categories = [
  { id: "cat-tavuklu", name: "Tavuklu Yemekler", active: true },
  { id: "cat-yan", name: "Yan Ürünler", active: true },
  { id: "cat-pilav", name: "Pilav Üstü", active: true },
  { id: "cat-tatli", name: "Tatlılar", active: true },
];

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);

describe("yemek kataloğu içe aktarma", () => {
  it("CSV ve JSON satırlarını aynı alanlarla okur", () => {
    expect(CATALOG_IMPORT_TEMPLATE.split("\n")[0]).toBe("ad,kategori,grup,fotograf,aktif,fiyat,aciklama");
    const csv = parseCatalogDocument(
      "ornek.csv",
      "ad;kategori;grup;fotograf;aktif\nFaz3 Corba;Yan Ürünler;Çorba;;aktif\n",
    );
    const json = parseCatalogDocument(
      "ornek.json",
      JSON.stringify([{ ad: "Faz3 Corba", kategori: "Yan Ürünler", grup: "Çorba", fotograf: "", aktif: true }]),
    );
    expect(csv.ok && json.ok).toBe(true);
    if (csv.ok && json.ok) {
      expect(csv.rows[0]).toMatchObject({ name: "Faz3 Corba", categoryName: "Yan Ürünler", slotText: "Çorba", activeText: "aktif" });
      expect(json.rows[0]).toMatchObject({ name: "Faz3 Corba", slotText: "Çorba", activeText: "true" });
    }
  });

  it("yeni, tekrar, hatalı ve eksik fotoğraf satırlarını ayırır", () => {
    const parsed = parseCatalogDocument(
      "ornek.csv",
      [
        "ad,kategori,grup,fotograf,aktif",
        "Faz3 Ana,Tavuklu Yemekler,Ana yemek,faz3.png,aktif",
        "Faz3 Ana,Tavuklu Yemekler,Ana yemek,faz3.png,aktif",
        "Faz3 Eksik,Yan Ürünler,Çorba,,pasif",
        "Faz3 Bozuk,Olmayan,Ana yemek,faz3.png,aktif",
        "Faz3 Yol,Pilav Üstü,Pilav / garnitür,../../gizli.png,aktif",
        "Faz3 Adres,Pilav Üstü,garnitür,https://ornek.invalid/a.jpg,aktif",
      ].join("\n"),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const plan = buildCatalogPlan(
      parsed.rows,
      categories,
      [{ id: "var", name: "Faz3 Eski", photoKey: null }],
      new Map([["faz3.png", { ok: true, bytes: png, contentType: "image/png" }]]),
    );
    expect(plan.map((row) => row.outcome)).toEqual(["create", "skip", "create", "error", "error", "error"]);
    expect(plan[2]?.missingPhoto).toBe(true);
    expect(plan[3]?.message).toMatch(/eşleşmiyor/);
    expect(plan[4]?.message).toMatch(/geçersiz/);
    expect(plan[5]?.message).toMatch(/sunucudan okunmaz/);
    expect(photoReference("/tmp/gizli.png")).toEqual({
      error: "Fotoğraf yolu sunucudan okunmaz. Dosya adını yazıp fotoğrafı birlikte yükleyin.",
    });
  });

  it("fotoğrafı olmayan mevcut kaydı ikinci aktarımda çoğaltmaz", () => {
    const parsed = parseCatalogDocument(
      "ornek.json",
      JSON.stringify({ yemekler: [{ name: "Faz3 Eski", category: "Tavuklu Yemekler", slot: "MAIN", photo: "eski.png", active: "aktif" }] }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const withPhoto = buildCatalogPlan(
      parsed.rows,
      categories,
      [{ id: "var", name: "faz3 eski", photoKey: null }],
      new Map([["eski.png", { ok: true, bytes: png, contentType: "image/png" }]]),
    );
    expect(withPhoto[0]?.outcome).toBe("attach-photo");
    const already = buildCatalogPlan(
      parsed.rows,
      categories,
      [{ id: "var", name: "Faz3 Eski", photoKey: "abc" }],
      new Map([["eski.png", { ok: true, bytes: png, contentType: "image/png" }]]),
    );
    expect(already[0]?.outcome).toBe("skip");
  });

  it("eski beş sütunu korur, fiyatı doğrular ve tatlıyı ayrı gruba alır", () => {
    expect(parseCatalogPrice("")).toEqual({ ok: true, price: null });
    expect(parseCatalogPrice("19,90")).toEqual({ ok: true, price: "19.90" });
    expect(parseCatalogPrice("+19.9")).toEqual({ ok: true, price: "19.90" });
    expect(parseCatalogPrice("bedava").ok).toBe(false);
    const oldFile = parseCatalogDocument(
      "eski.csv",
      "ad,kategori,grup,fotograf,aktif\n\"TERBİYELİ ÇORBA (19,90)\",Yan Ürünler,Çorba,,aktif\nFIRIN SÜTLAÇ,Tatlılar,Pilav / garnitür,,aktif\n",
    );
    expect(oldFile.ok).toBe(true);
    if (!oldFile.ok) {
      return;
    }
    const plan = buildCatalogPlan(oldFile.rows, categories, [], new Map());
    expect(plan[0]).toMatchObject({ outcome: "create", slot: "SOUP", price: null, categoryLabel: "Yan Ürünler", slotLabel: "Çorba" });
    expect(plan[0]?.name).toBe("TERBİYELİ ÇORBA (19,90)");
    expect(plan[1]).toMatchObject({ outcome: "create", slot: "DESSERT", price: null, categoryLabel: "Tatlılar", slotLabel: "Tatlı" });
    expect(plan[1]?.message).toMatch(/tatlı grubuna alındı/);
    const priced = parseCatalogDocument(
      "yeni.csv",
      "ad,kategori,grup,fotograf,aktif,fiyat,aciklama\nFaz3 Ana,Tavuklu Yemekler,Ana yemek,,aktif,\"19,90\",Izgara\nFaz3 Hatali,Tavuklu Yemekler,Ana yemek,,aktif,abc,\n",
    );
    expect(priced.ok).toBe(true);
    if (!priced.ok) {
      return;
    }
    const rows = buildCatalogPlan(priced.rows, categories, [], new Map());
    expect(rows[0]).toMatchObject({ outcome: "create", price: "19.90", description: "Izgara" });
    expect(rows[1]?.outcome).toBe("error");
    expect(rows[1]?.message).toMatch(/Fiyat geçersiz/);
  });

  it("önizlemeyi seçilen dosyanın özetine bağlar", async () => {
    const text = "ad,kategori,grup,fotograf,aktif\nFaz3 Ana,Tavuklu Yemekler,Ana yemek,,aktif\n";
    const parsed = parseCatalogDocument("liste.csv", text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const bytes = new TextEncoder().encode(text);
    const source = buildCatalogSource({ name: "liste.csv", text, bytes }, []);
    const preview = toCatalogPreview(buildCatalogPlan(parsed.rows, categories, [], new Map()), source);
    expect(formatCatalogPreviewSummary(preview)).toBe("Yeni kayıt: 1. Eşleşen: 0. Hatalı: 0. Eksik fotoğraf: 1.");
    expect(preview.rows[0]).toMatchObject({ categoryLabel: "Tavuklu Yemekler", slotLabel: "Ana yemek" });
    expect(previewMatchesSource(preview, source)).toBe(true);
    expect(previewMatchesSource(preview, null)).toBe(false);
    const other = buildCatalogSource({ name: "liste.csv", text: "farkli", bytes: new TextEncoder().encode("farkli") }, []);
    expect(previewMatchesSource(preview, other)).toBe(false);
    const file = new File([bytes], "liste.csv", { type: "text/csv" });
    expect(await sourceFromBrowserFiles(file, [])).toEqual(source);
  });
});
