import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/server/errors";

export const MAX_FINANCE_DOCUMENT_BYTES = 8 * 1024 * 1024;

const TYPES = {
  pdf: {
    mime: "application/pdf",
    matches: (bytes) => bytes.subarray(0, 4).toString("utf8") === "%PDF",
  },
  jpg: {
    mime: "image/jpeg",
    matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  png: {
    mime: "image/png",
    matches: (bytes) =>
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  },
  webp: {
    mime: "image/webp",
    matches: (bytes) =>
      bytes.subarray(0, 4).toString("utf8") === "RIFF" &&
      bytes.subarray(8, 12).toString("utf8") === "WEBP",
  },
};

export function financeStorageDir() {
  return path.resolve(process.cwd(), "storage", "finance-documents");
}

export function inspectFinanceFile(file



) {
  if (file.bytes.length === 0) {
    throw new AppError("Belge boş.", "VALIDATION", 400);
  }
  if (file.bytes.length > MAX_FINANCE_DOCUMENT_BYTES) {
    throw new AppError("Belge 8 MB sınırını aşıyor.", "VALIDATION", 400);
  }

  const extension = file.fileName.toLowerCase().split(".").pop() ?? "";
  const detected = TYPES[extension];
  if (!detected || !detected.matches(file.bytes)) {
    throw new AppError("Yalnızca PDF, JPG, PNG veya WEBP yüklenebilir.", "VALIDATION", 400);
  }

  const safeName = path.basename(file.fileName).replace(/[^\w.\- ]+/g, "").slice(0, 120);
  return {
    bytes: file.bytes,
    fileName: safeName || `belge.${extension}`,
    contentType: detected.mime,
  };
}

export async function saveFinanceFile(storageKey, bytes) {
  if (!/^[a-f0-9]{32}$/.test(storageKey)) {
    throw new AppError("Belge anahtarı geçersiz.", "VALIDATION", 400);
  }
  const directory = financeStorageDir();
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, storageKey), bytes, { flag: "wx" });
}

export async function readFinanceFile(storageKey) {
  if (!/^[a-f0-9]{32}$/.test(storageKey)) {
    throw new AppError("Belge bulunamadı.", "NOT_FOUND", 404);
  }
  try {
    return await readFile(path.join(financeStorageDir(), storageKey));
  } catch {
    throw new AppError("Belge bulunamadı.", "NOT_FOUND", 404);
  }
}

export async function removeFinanceFile(storageKey) {
  if (!/^[a-f0-9]{32}$/.test(storageKey)) {
    return;
  }
  await rm(path.join(financeStorageDir(), storageKey), { force: true });
}
