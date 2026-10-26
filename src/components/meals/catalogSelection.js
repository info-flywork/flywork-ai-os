import { catalogPhotoMaterial } from "@/server/meals/importCatalog";

async function sha256Hex(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sourceFromBrowserFiles(file, photos) {
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const photoParts = await Promise.all(
    photos.map(async (photo) => ({ name: photo.name, bytes: new Uint8Array(await photo.arrayBuffer()) })),
  );
  return {
    fileName: file.name,
    fileBytes: file.size,
    fileDigest: await sha256Hex(fileBytes),
    photoDigest: await sha256Hex(catalogPhotoMaterial(photoParts)),
  };
}
