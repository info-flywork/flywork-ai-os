import "server-only";

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/server/errors";

const ROOT = path.join(process.cwd(), "storage", "products", "user");
const FILE = path.join(ROOT, "bugs.json");
const BLOBS = path.join(ROOT, "bug-blobs");
const MAX_BYTES = 20 * 1024 * 1024;

const TYPES = {
  pdf: { mime: "application/pdf", check: "pdf" },
  doc: { mime: "application/msword", check: "office" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", check: "zip" },
  xls: { mime: "application/vnd.ms-excel", check: "office" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", check: "zip" },
  xlsm: { mime: "application/vnd.ms-excel.sheet.macroEnabled.12", check: "zip" },
  csv: { mime: "text/csv; charset=utf-8", check: "text" },
  ppt: { mime: "application/vnd.ms-powerpoint", check: "office" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", check: "zip" },
  png: { mime: "image/png", check: "png" },
  jpg: { mime: "image/jpeg", check: "jpeg" },
  jpeg: { mime: "image/jpeg", check: "jpeg" },
  webp: { mime: "image/webp", check: "webp" },
  gif: { mime: "image/gif", check: "gif" },
  heic: { mime: "image/heic", check: "heif" },
  heif: { mime: "image/heif", check: "heif" },
};

let queue = Promise.resolve();

function locked(task) {
  const run = queue.then(task, task);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function readStore() {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    return {
      pages: Array.isArray(parsed.pages) ? parsed.pages : [],
      sheets: Array.isArray(parsed.sheets) ? parsed.sheets : [],
    };
  } catch {
    return { pages: [], sheets: [] };
  }
}

async function saveStore(store) {
  await mkdir(ROOT, { recursive: true });
  const temp = path.join(ROOT, `bugs.${process.pid}.tmp`);
  await writeFile(temp, JSON.stringify(store));
  await rename(temp, FILE);
}

function clip(value, max) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function cleanDate(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function loadPages() {
  const store = readStore();
  if (Array.isArray(store.pages) && store.pages.length > 0) return store.pages;
  const page = { id: randomBytes(8).toString("hex"), name: "Sayfa 1", rows: [] };
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(FILE, JSON.stringify({ pages: [page] }));
  return [page];
}

function findPage(pageId) {
  const id = String(pageId ?? "");
  return loadPages().find((page) => page.id === id) ?? null;
}

function publicPage(page) {
  return {
    id: page.id,
    name: clip(page.name, 80) || "Sayfa",
    rows: Array.isArray(page.rows) ? page.rows.filter((row) => row && typeof row.id === "string").map(publicRow) : [],
  };
}

function publicFile(file) {
  if (!file || typeof file.id !== "string" || typeof file.name !== "string") return null;
  if (!/^[a-f0-9]{32}$/.test(file.id)) return null;
  const name = clip(file.name, 120);
  return name ? { id: file.id, name } : null;
}

function publicRow(row) {
  return {
    id: String(row.id),
    done: Boolean(row.done),
    date: cleanDate(row.date),
    detail: clip(row.detail, 4000),
    softwareNote: clip(row.softwareNote, 4000),
    userNote: clip(row.userNote, 4000),
    status: clip(row.status, 80),
    store: clip(row.store, 80),
    author: clip(row.author, 80),
    file: publicFile(row.file),
  };
}

export function listBugPages() {
  return loadPages().map((page) => ({ id: page.id, name: clip(page.name, 80) || "Sayfa" }));
}

export function readBugPage(pageId) {
  const page = findPage(pageId);
  return page ? publicPage(page) : null;
}

export function createBugPage() {
  return locked(async () => {
    const pages = loadPages();
    const page = { id: randomBytes(8).toString("hex"), name: `Sayfa ${pages.length + 1}`, rows: [] };
    pages.push(page);
    await saveStore({ pages });
    return { id: page.id, name: page.name };
  });
}

export function deleteBugPage(pageId) {
  return locked(async () => {
    const store = readStore();
    const pages = Array.isArray(store.pages) ? store.pages : [];
    const index = pages.findIndex((item) => item.id === String(pageId ?? ""));
    if (index < 0) throw new AppError("Sayfa bulunamadı.", "NOT_FOUND", 404);
    const [removed] = pages.splice(index, 1);
    const fileIds = (removed.rows ?? []).map((row) => publicFile(row?.file)?.id ?? "").filter(Boolean);
    let next = pages[Math.min(index, pages.length - 1)] ?? null;
    if (!next) {
      next = { id: randomBytes(8).toString("hex"), name: "Sayfa 1", rows: [] };
      pages.push(next);
    }
    await saveStore({ pages });
    await Promise.all(fileIds.map((id) => rm(path.join(BLOBS, id), { force: true })));
    return { id: next.id, name: clip(next.name, 80) || "Sayfa" };
  });
}

export function renameBugPage(pageId, rawName) {
  return locked(async () => {
    const store = readStore();
    const page = (store.pages ?? []).find((item) => item.id === String(pageId ?? ""));
    if (!page) throw new AppError("Sayfa bulunamadı.", "NOT_FOUND", 404);
    page.name = clip(rawName, 80) || "Sayfa";
    await saveStore(store);
    return { id: page.id, name: page.name };
  });
}

function pageOf(store, pageId) {
  const page = (store.pages ?? []).find((item) => item.id === String(pageId ?? ""));
  if (!page) throw new AppError("Sayfa bulunamadı.", "NOT_FOUND", 404);
  if (!Array.isArray(page.rows)) page.rows = [];
  return page;
}

export function createBugRow(pageId, authorName) {
  return locked(async () => {
    const store = readStore();
    const sheet = pageOf(store, pageId);
    const row = {
      id: randomBytes(8).toString("hex"),
      done: false,
      date: today(),
      detail: "",
      softwareNote: "",
      userNote: "",
      status: "",
      store: "",
      author: clip(authorName, 80),
      file: null,
    };
    sheet.rows.push(row);
    await saveStore(store);
    return publicRow(row);
  });
}

export function updateBugRow(pageId, rowId, patch) {
  return locked(async () => {
    const store = readStore();
    const sheet = pageOf(store, pageId);
    const row = sheet?.rows?.find((item) => item.id === String(rowId ?? ""));
    if (!row) throw new AppError("Satır bulunamadı.", "NOT_FOUND", 404);
    const input = patch && typeof patch === "object" ? patch : {};
    if ("done" in input) row.done = Boolean(input.done);
    if ("date" in input) row.date = cleanDate(input.date);
    if ("detail" in input) row.detail = clip(input.detail, 4000);
    if ("softwareNote" in input) row.softwareNote = clip(input.softwareNote, 4000);
    if ("userNote" in input) row.userNote = clip(input.userNote, 4000);
    if ("status" in input) row.status = clip(input.status, 80);
    if ("store" in input) row.store = clip(input.store, 80);
    if ("author" in input) row.author = clip(input.author, 80);
    await saveStore(store);
    return publicRow(row);
  });
}

export function deleteBugRow(pageId, rowId) {
  return locked(async () => {
    const store = readStore();
    const sheet = pageOf(store, pageId);
    const row = sheet.rows.find((item) => item.id === String(rowId ?? ""));
    if (!row) throw new AppError("Satır bulunamadı.", "NOT_FOUND", 404);
    const fileId = publicFile(row.file)?.id ?? "";
    sheet.rows = sheet.rows.filter((item) => item.id !== row.id);
    await saveStore(store);
    if (fileId) await rm(path.join(BLOBS, fileId), { force: true });
    return { message: "Satır silindi." };
  });
}

function startsWith(bytes, signature) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function matches(check, bytes) {
  if (bytes.length < 4) return false;
  if (check === "pdf") return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
  if (check === "zip") return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (check === "office") return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) || startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (check === "png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
  if (check === "jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (check === "gif") {
    if (bytes.length < 6) return false;
    return bytes.subarray(0, 6).toString("latin1") === "GIF87a" || bytes.subarray(0, 6).toString("latin1") === "GIF89a";
  }
  if (check === "webp") return bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
  if (check === "heif") return bytes.length >= 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp";
  if (check === "text") return !bytes.subarray(0, 4096).includes(0);
  return false;
}

function cleanFileName(value) {
  const base = path.basename(String(value ?? "").replace(/\\/g, "/")).replace(/\s+/g, " ").trim();
  if (!base || base === "." || base === ".." || base.length > 120 || /[\u0000]/.test(base)) {
    throw new AppError("Dosya adı geçersiz.", "VALIDATION", 400);
  }
  return base;
}

export function attachBugFile(pageId, rowId, upload) {
  return locked(async () => {
    const store = readStore();
    const sheet = pageOf(store, pageId);
    const name = cleanFileName(upload?.name);
    const spec = TYPES[path.extname(name).slice(1).toLowerCase()];
    if (!spec) throw new AppError("Bu dosya türü desteklenmiyor. PDF, Word, Excel, PowerPoint veya fotoğraf yükleyin.", "VALIDATION", 400);
    const bytes = upload?.bytes;
    if (!bytes || bytes.length === 0) throw new AppError("Dosya boş.", "VALIDATION", 400);
    if (bytes.length > MAX_BYTES) throw new AppError("Dosya 20 MB sınırını aşıyor.", "VALIDATION", 400);
    if (!matches(spec.check, bytes)) throw new AppError("Dosya içeriği uzantısıyla uyuşmuyor.", "VALIDATION", 400);

    const row = sheet.rows.find((item) => item.id === String(rowId ?? ""));
    if (!row) throw new AppError("Satır bulunamadı.", "NOT_FOUND", 404);
    const previous = publicFile(row.file)?.id ?? "";
    const id = randomBytes(16).toString("hex");
    await mkdir(BLOBS, { recursive: true });
    await writeFile(path.join(BLOBS, id), bytes, { flag: "wx" });
    row.file = { id, name };
    try {
      await saveStore(store);
    } catch (error) {
      await rm(path.join(BLOBS, id), { force: true });
      throw error;
    }
    if (previous) await rm(path.join(BLOBS, previous), { force: true });
    return publicRow(row);
  });
}

export function clearBugFile(pageId, rowId) {
  return locked(async () => {
    const store = readStore();
    const sheet = pageOf(store, pageId);
    const row = sheet.rows.find((item) => item.id === String(rowId ?? ""));
    if (!row) throw new AppError("Satır bulunamadı.", "NOT_FOUND", 404);
    const previous = publicFile(row.file)?.id ?? "";
    row.file = null;
    await saveStore(store);
    if (previous) await rm(path.join(BLOBS, previous), { force: true });
    return publicRow(row);
  });
}

export async function openBugFile(fileId) {
  const id = String(fileId ?? "");
  if (!/^[a-f0-9]{32}$/.test(id)) throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  const store = readStore();
  let name = "";
  for (const sheet of store.pages ?? []) {
    for (const row of sheet.rows ?? []) {
      if (row?.file?.id === id) name = clip(row.file.name, 120);
    }
  }
  if (!name) throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  try {
    const bytes = await readFile(path.join(BLOBS, id));
    const spec = TYPES[path.extname(name).slice(1).toLowerCase()];
    const contentType = spec?.mime ?? "application/octet-stream";
    return {
      bytes,
      contentType,
      fileName: name,
      inline: contentType.startsWith("image/") || contentType === "application/pdf",
    };
  } catch {
    throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  }
}
