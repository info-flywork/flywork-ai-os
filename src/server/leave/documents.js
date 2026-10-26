import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/server/errors";

export const MAX_LEAVE_DOCUMENT_BYTES = 5 * 1024 * 1024;

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

export function leaveStorageDir() {
  return path.resolve(process.cwd(), "storage", "leave-documents");
}

export function inspectLeaveFile(file



) {
  if (file.bytes.length === 0) {
    throw new AppError("Belge boş.", "VALIDATION", 400);
  }
  if (file.bytes.length > MAX_LEAVE_DOCUMENT_BYTES) {
    throw new AppError("Belge 5 MB sınırını aşıyor.", "VALIDATION", 400);
  }

  const detected = Object.values(TYPES).find((type) => type.matches(file.bytes));
  if (!detected) {
    throw new AppError("Belge PDF, JPEG, PNG veya WEBP olmalı.", "VALIDATION", 400);
  }

  return {
    bytes: file.bytes,
    fileName: safeFileName(file.fileName),
    contentType: detected.mime,
  };
}

export async function writeLeaveFile(storageKey, bytes) {
  const target = resolveKey(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}

export async function readLeaveFile(storageKey) {
  return readFile(resolveKey(storageKey));
}

export async function removeLeaveFile(storageKey) {
  if (!/^[a-f0-9]{32}$/.test(storageKey)) {
    return;
  }
  await rm(resolveKey(storageKey), { force: true });
}

function resolveKey(storageKey) {
  if (!/^[a-f0-9]{32}$/.test(storageKey)) {
    throw new AppError("Belge bulunamadı.", "NOT_FOUND", 404);
  }
  const root = leaveStorageDir();
  const target = path.resolve(root, storageKey);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new AppError("Belge bulunamadı.", "NOT_FOUND", 404);
  }
  return target;
}

function safeFileName(value) {
  const base = path.basename(value).replace(/[^\p{L}\p{N}._ -]/gu, "_").trim();
  const clipped = base.slice(0, 80);
  return clipped || "belge";
}
