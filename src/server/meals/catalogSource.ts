import "server-only";
import { createHash } from "node:crypto";
import { catalogPhotoMaterial, type CatalogSource } from "@/server/meals/importCatalog";

export function buildCatalogSource(
  file: { name: string; text: string; bytes?: Uint8Array },
  photos: { name: string; bytes: Uint8Array }[],
): CatalogSource {
  const fileBytes = file.bytes ?? new TextEncoder().encode(file.text);
  return {
    fileName: file.name,
    fileBytes: fileBytes.byteLength,
    fileDigest: createHash("sha256").update(fileBytes).digest("hex"),
    photoDigest: createHash("sha256").update(catalogPhotoMaterial(photos)).digest("hex"),
  };
}
