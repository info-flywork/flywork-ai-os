import ProductLibrary from "@/components/products/ProductLibrary";
import { redirectMealOnlyUser } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { listApplicationNames, listFigmaLinks } from "@/server/products/figmaLinks";
import { listProducts } from "@/server/products/library";

export const instant = false;

function one(value) {
  const picked = Array.isArray(value) ? value[0] : value;
  return picked ? picked : undefined;
}

export default async function UrunlerPage({ searchParams }) {
  const user = await requireUser();
  redirectMealOnlyUser(user);
  const query = await searchParams;
  const tab = one(query.sekme);
  const kind = tab === "oyunlar" || tab === "aso" || tab === "analiz" || tab === "figma" ? tab : "uygulamalar";
  if (kind === "analiz") {
    return <ProductLibrary products={[]} kind={kind} />;
  }
  if (kind === "figma") {
    const area = one(query.alan) === "design" ? "design" : "flow";
    return <ProductLibrary products={[]} kind={kind} area={area} figmaLinks={listFigmaLinks()} figmaApps={listApplicationNames()} />;
  }
  const products = listProducts().filter((product) => {
    if (kind === "oyunlar") return product.kind === "game";
    if (kind === "aso") return product.kind === "aso";
    return product.kind !== "game" && product.kind !== "aso";
  });
  return <ProductLibrary products={products} kind={kind} />;
}
