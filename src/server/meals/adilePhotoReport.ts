import catalog from "@/server/meals/adilePhotoCatalog.json";
import { buildPhotoReview, type PhotoCandidate, type PhotoReviewRow } from "@/server/meals/photoMatch";

export const ADILE_SOURCE_SITE = "https://adilesultanevyemekleri.com/";
export const ADILE_MENU_SITE = "https://siparis.adilesultanevyemekleri.com/";
export const ADILE_RIGHTS_NOTE =
  "Sipariş sitesindeki üyelik koşulları grafiklerin haklarının Adile Sultan Ev Yemekleri'nde olduğunu belirtiyor. Ayrı bir yeniden kullanım izni yok. Durum doğrulanmadı.";
export const ADILE_REPRESENTATIVE_NOTE = "Site, ürün görsellerinin temsilî olduğunu belirtiyor.";

const CATEGORY_PAGES = [
  "corbalar",
  "etli-yemekler",
  "tavuklu-yemekler",
  "etibol-tavuklu-yemekler",
  "etli-sebzeli-yemekler",
  "sebzeli-yemekler",
  "zeytinyaglilar",
  "pilav-ustu-yemekler",
  "makarna-yemekleri",
  "makarnalar-ve-pilavlar",
  "yan-urunler",
  "tatlilar",
] as const;

export const ADILE_CATEGORY_PAGES = CATEGORY_PAGES.map(
  (slug) => `https://siparis.adilesultanevyemekleri.com/category/${slug}`,
);

export function adilePhotoRows(): PhotoReviewRow[] {
  return buildPhotoReview(catalog.dishes, catalog.products as PhotoCandidate[]);
}

export function adilePhotoSummary(rows: PhotoReviewRow[] = adilePhotoRows()) {
  return {
    examined: rows.length,
    images: new Set(catalog.products.map((product) => product.imageUrl)).size,
    products: catalog.products.length,
    kesin: rows.filter((row) => row.status === "kesin").length,
    manuel: rows.filter((row) => row.status === "manuel").length,
    missing: rows.filter((row) => row.status === "yok").length,
    rightsVerified: false,
  };
}
