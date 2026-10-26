import "server-only";
import { createHash } from "node:crypto";
import { catalogPhotoMaterial } from "@/server/meals/importCatalog";

export function buildCatalogSource(
  file,
  photos,
) {
  const fileBytes = file.bytes ?? new TextEncoder().encode(file.text);
  return {
    fileName: file.name,
    fileBytes: fileBytes.byteLength,
    fileDigest: createHash("sha256").update(fileBytes).digest("hex"),
    photoDigest: createHash("sha256").update(catalogPhotoMaterial(photos)).digest("hex"),
  };
}
