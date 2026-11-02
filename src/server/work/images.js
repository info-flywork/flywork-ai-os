import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/server/errors";

const MAX_BYTES = 20 * 1024 * 1024;

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

function rootDir() {
  return path.resolve(process.cwd(), "storage", "work-images");
}

function isZip(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

function isOle(bytes) {
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

function isText(bytes) {
  return !bytes.subarray(0, 4096).includes(0);
}

const FILE_TYPES = {
  pdf: { mime: "application/pdf", test: (bytes) => bytes.subarray(0, 4).toString("utf8") === "%PDF" },
  doc: { mime: "application/msword", test: isOle },
  xls: { mime: "application/vnd.ms-excel", test: isOle },
  ppt: { mime: "application/vnd.ms-powerpoint", test: isOle },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", test: isZip },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", test: isZip },
  xlsm: { mime: "application/vnd.ms-excel.sheet.macroEnabled.12", test: isZip },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", test: isZip },
  zip: { mime: "application/zip", test: isZip },
  txt: { mime: "text/plain", test: isText },
  csv: { mime: "text/csv", test: isText },
};

export function safeFileName(name) {
  const base = String(name || "dosya").split(/[/\\]/).pop().replace(/[\u0000-\u001f]/g, "").trim().slice(0, 160);
  return base || "dosya";
}

export function inspectWorkFile(bytes, name) {
  if (bytes.length === 0) throw new AppError("Dosya boş.", "VALIDATION", 400);
  if (bytes.length > MAX_BYTES) throw new AppError("Dosya 20 MB sınırını aşıyor.", "VALIDATION", 400);
  const ext = safeFileName(name).split(".").pop()?.toLowerCase() ?? "";
  const type = FILE_TYPES[ext];
  if (!type || !type.test(bytes)) {
    throw new AppError("Dosya PDF, Office, ZIP, TXT veya CSV olmalı.", "VALIDATION", 400);
  }
  return { bytes, contentType: type.mime, fileName: safeFileName(name) };
}

export function inspectWorkImage(bytes) {
  if (bytes.length === 0) throw new AppError("Görsel boş.", "VALIDATION", 400);
  if (bytes.length > MAX_BYTES) throw new AppError("Görsel 20 MB sınırını aşıyor.", "VALIDATION", 400);
  const detected = Object.values(TYPES).find((type) => type.matches(bytes));
  if (!detected) throw new AppError("Görsel JPEG, PNG veya WEBP olmalı.", "VALIDATION", 400);
  return { bytes, contentType: detected.mime };
}

function resolveKey(storageKey) {
  if (!/^[a-f0-9]{32}$/.test(storageKey)) throw new AppError("Görsel bulunamadı.", "NOT_FOUND", 404);
  const root = rootDir();
  const target = path.resolve(root, storageKey);
  if (!target.startsWith(`${root}${path.sep}`)) throw new AppError("Görsel bulunamadı.", "NOT_FOUND", 404);
  return target;
}

export async function writeWorkImage(storageKey, bytes) {
  const target = resolveKey(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}

export async function readWorkImage(storageKey) {
  try {
    return await readFile(resolveKey(storageKey));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new AppError("Görsel bulunamadı.", "NOT_FOUND", 404);
    }
    throw error;
  }
}

export async function removeWorkImage(storageKey) {
  if (!/^[a-f0-9]{32}$/.test(storageKey)) return;
  await rm(resolveKey(storageKey), { force: true });
}
