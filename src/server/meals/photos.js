import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/server/errors";

const MAX_BYTES = 2 * 1024 * 1024;

const TYPES = {
  jpg: {
    mime: "image/jpeg",
    matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  png: {
    mime: "image/png",
    matches: (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  },
  webp: {
    mime: "image/webp",
    matches: (bytes) =>
      bytes.subarray(0, 4).toString("utf8") === "RIFF" && bytes.subarray(8, 12).toString("utf8") === "WEBP",
  },
};

export function mealPhotoDir() {
  return path.resolve(process.cwd(), "storage", "meal-photos");
}

export function inspectMealPhoto(file) {
  if (file.bytes.length === 0) {
    throw new AppError("Fotoğraf boş.", "VALIDATION", 400);
  }
  if (file.bytes.length > MAX_BYTES) {
    throw new AppError("Fotoğraf 2 MB sınırını aşıyor.", "VALIDATION", 400);
  }
  const detected = Object.values(TYPES).find((type) => type.matches(file.bytes));
  if (!detected) {
    throw new AppError("Fotoğraf JPEG, PNG veya WEBP olmalı.", "VALIDATION", 400);
  }
  return { bytes: file.bytes, contentType: detected.mime };
}

function resolveKey(storageKey) {
  if (!/^[a-f0-9]{32}$/.test(storageKey)) {
    throw new AppError("Fotoğraf bulunamadı.", "NOT_FOUND", 404);
  }
  const root = mealPhotoDir();
  const target = path.resolve(root, storageKey);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new AppError("Fotoğraf bulunamadı.", "NOT_FOUND", 404);
  }
  return target;
}

export async function writeMealPhoto(storageKey, bytes) {
  const target = resolveKey(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}

export async function readMealPhoto(storageKey) {
  try {
    return await readFile(resolveKey(storageKey));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new AppError("Fotoğraf bulunamadı.", "NOT_FOUND", 404);
    }
    throw error;
  }
}

export async function removeMealPhoto(storageKey) {
  if (!storageKey || !/^[a-f0-9]{32}$/.test(storageKey)) {
    return;
  }
  await rm(resolveKey(storageKey), { force: true });
}
