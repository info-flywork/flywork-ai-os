import "server-only";

import { listAppProducts } from "@/server/products/archives";
import { products } from "@/server/products/catalog";
import { mergeUserLibrary } from "@/server/products/userLibrary";

export function listProducts() {
  return mergeUserLibrary([...products.filter((product) => product.kind !== "app"), ...listAppProducts()]);
}
