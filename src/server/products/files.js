import "server-only";

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import zlib from "node:zlib";

import { AppError } from "@/server/errors";
import { findArchiveEntry } from "@/server/products/archives";
import { assertProductVisible, openUserFile } from "@/server/products/userLibrary";

const ROOT = path.join(process.cwd(), "storage", "products");

const TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ai": "application/vnd.adobe.illustrator",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".html": "text/plain; charset=utf-8",
  ".htm": "text/plain; charset=utf-8",
};

function contentTypeFor(fileName, fallback) {
  return TYPES[path.extname(fileName).toLowerCase()] || fallback;
}

function canInline(contentType) {
  return contentType.startsWith("image/") || contentType.startsWith("video/") || contentType === "application/pdf";
}

function openArchiveFile(segments) {
  const [zipId, ...memberParts] = segments;
  if (!/^\d{3}$/.test(zipId || "") || memberParts.length === 0) {
    throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  }
  const entry = findArchiveEntry(zipId, memberParts.join("/"));
  if (!entry || (entry.method !== 0 && entry.method !== 8)) {
    throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  }
  const contentType = contentTypeFor(entry.name, "application/octet-stream");
  const raw = entry.compressed
    ? createReadStream(entry.zipPath, { start: entry.offset, end: entry.offset + entry.compressed - 1 })
    : Readable.from([]);
  return {
    stream: entry.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw,
    size: entry.size,
    contentType,
    fileName: entry.name,
    inline: canInline(contentType),
  };
}

export async function openProductFile(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  }
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\"))) {
    throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  }
  assertProductVisible(`/api/urun-dosya/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`);
  if (segments[0] === "arsiv") {
    return openArchiveFile(segments.slice(1));
  }
  if (segments[0] === "user") {
    if (segments.length !== 2) throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
    return openUserFile(segments[1]);
  }

  const root = path.resolve(ROOT);
  const resolved = path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  }

  const contentType = TYPES[path.extname(resolved).toLowerCase()];
  if (!contentType) {
    throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  }

  try {
    const bytes = await readFile(resolved);
    return {
      bytes,
      contentType,
      fileName: segments.at(-1),
      inline: contentType.startsWith("image/") || contentType === "application/pdf",
    };
  } catch {
    throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  }
}
