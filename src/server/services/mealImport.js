import "server-only";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { assertCan } from "@/server/auth/permissions";
import { withDatabase } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  MAX_IMPORT_PHOTOS,
  buildCatalogPlan,
  foldCatalogText,
  parseCatalogDocument,
  toCatalogPreview,



} from "@/server/meals/importCatalog";
import { buildCatalogSource } from "@/server/meals/catalogSource";
import { inspectMealPhoto, removeMealPhoto, writeMealPhoto } from "@/server/meals/photos";

const MAX_CATALOG_BYTES = 1024 * 1024;

 


function assertCatalogFile(file) {
  if (!file.text.trim()) {
    throw new AppError("Dosya boş.", "VALIDATION", 400);
  }
  if (Buffer.byteLength(file.text) > MAX_CATALOG_BYTES) {
    throw new AppError("Katalog dosyası 1 MB sınırını aşıyor.", "VALIDATION", 400);
  }
}

function indexPhotos(photos) {
  if (photos.length > MAX_IMPORT_PHOTOS) {
    throw new AppError(
      `Tek aktarımda en fazla ${MAX_IMPORT_PHOTOS} fotoğraf yükleyin. Kalanları sonraki aktarımda ekleyebilirsiniz.`,
      "VALIDATION",
      400,
    );
  }
  const counts = new Map();
  for (const photo of photos) {
    const key = foldCatalogText(path.basename(photo.name));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const indexed = new Map();
  for (const photo of photos) {
    const key = foldCatalogText(path.basename(photo.name));
    if ((counts.get(key) ?? 0) > 1) {
      indexed.set(key, { ok: false, message: "Aynı fotoğraf adı birden fazla yüklendi." });
      continue;
    }
    try {
      const checked = inspectMealPhoto({ bytes: photo.bytes, contentType: "application/octet-stream" });
      indexed.set(key, { ok: true, bytes: checked.bytes, contentType: checked.contentType });
    } catch (error) {
      indexed.set(key, {
        ok: false,
        message: error instanceof AppError ? error.message : "Fotoğraf doğrulanamadı.",
      });
    }
  }
  return indexed;
}

async function planImport(file, photos) {
  assertCatalogFile(file);
  const parsed = parseCatalogDocument(file.name, file.text);
  if (!parsed.ok) {
    throw new AppError(parsed.message, "VALIDATION", 400);
  }
  const indexed = indexPhotos(photos);
  return withDatabase(async (db) => {
    const [categories, dishes] = await Promise.all([
      db.mealCategory.findMany({ select: { id: true, name: true, active: true } }),
      db.mealDish.findMany({ select: { id: true, name: true, photoKey: true } }),
    ]);
    return buildCatalogPlan(parsed.rows, categories, dishes, indexed);
  });
}

export async function previewMealCatalogImport(
  actor,
  file,
  photos,
) {
  assertCan(actor, "mealMenu:write");
  return toCatalogPreview(await planImport(file, photos), buildCatalogSource(file, photos));
}

async function applyRow(row) {
  try {
    if (row.outcome === "create") {
      if (!row.categoryId || !row.slot || row.active === null) {
        return "failed";
      }
      const photoKey = row.photo ? randomBytes(16).toString("hex") : null;
      if (row.photo && photoKey) {
        await writeMealPhoto(photoKey, row.photo.bytes);
      }
      try {
        await withDatabase((db) =>
          db.mealDish.create({
            data: {
              name: row.name,
              categoryId: row.categoryId,
              slot: row.slot,
              active: row.active,
              price: row.price,
              description: row.description,
              photoKey,
              photoType: row.photo?.contentType ?? null,
            },
            select: { id: true },
          }),
        );
      } catch (error) {
        await removeMealPhoto(photoKey);
        throw error;
      }
      return "created";
    }
    if (row.outcome === "attach-photo" && row.dishId && row.photo) {
      const photoKey = randomBytes(16).toString("hex");
      await writeMealPhoto(photoKey, row.photo.bytes);
      try {
        const updated = await withDatabase((db) =>
          db.mealDish.updateMany({
            where: { id: row.dishId, photoKey: null },
            data: { photoKey, photoType: row.photo?.contentType },
          }),
        );
        if (updated.count !== 1) {
          await removeMealPhoto(photoKey);
          return "failed";
        }
      } catch (error) {
        await removeMealPhoto(photoKey);
        throw error;
      }
      return "attached";
    }
    return "failed";
  } catch {
    return "failed";
  }
}

export async function commitMealCatalogImport(
  actor,
  file,
  photos,
  approved,
) {
  assertCan(actor, "mealMenu:write");
  if (!approved) {
    throw new AppError("İçe aktarma için açık onay gerekli.", "VALIDATION", 400);
  }
  const rows = await planImport(file, photos);
  const result = {
    created: 0,
    skipped: rows.filter((row) => row.outcome === "skip").length,
    failed: rows.filter((row) => row.outcome === "error").length,
    missingPhotos: 0,
    photosAttached: 0,
  };
  for (const row of rows) {
    if (row.outcome !== "create" && row.outcome !== "attach-photo") {
      continue;
    }
    const applied = await applyRow(row);
    if (applied === "created") {
      result.created += 1;
      if (row.missingPhoto) {
        result.missingPhotos += 1;
      }
    } else if (applied === "attached") {
      result.photosAttached += 1;
    } else {
      result.failed += 1;
    }
  }
  return result;
}
