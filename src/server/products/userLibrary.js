import "server-only";

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/server/errors";
import { listAppProducts } from "@/server/products/archives";
import { products as catalogProducts } from "@/server/products/catalog";

const ROOT = path.join(process.cwd(), "storage", "products", "user");
const INDEX = path.join(ROOT, "index.json");
const BLOBS = path.join(ROOT, "blobs");
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_DEPTH = 12;

const TAB_KIND = {
  uygulamalar: "app",
  oyunlar: "game",
  aso: "aso",
};

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
  png: { mime: "image/png", check: "png", image: true },
  jpg: { mime: "image/jpeg", check: "jpeg", image: true },
  jpeg: { mime: "image/jpeg", check: "jpeg", image: true },
  webp: { mime: "image/webp", check: "webp", image: true },
  gif: { mime: "image/gif", check: "gif", image: true },
  heic: { mime: "image/heic", check: "heif" },
  heif: { mime: "image/heif", check: "heif" },
};

let queue = Promise.resolve();

function locked(task) {
  const run = queue.then(task, task);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function emptyIndex() {
  return { roots: [], folders: [], files: [], hiddenProducts: [], hiddenFolders: [], hiddenFiles: [] };
}

function readIndex() {
  try {
    const parsed = JSON.parse(readFileSync(INDEX, "utf8"));
    return {
      roots: Array.isArray(parsed.roots) ? parsed.roots : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      files: Array.isArray(parsed.files) ? parsed.files : [],
      hiddenProducts: Array.isArray(parsed.hiddenProducts) ? parsed.hiddenProducts : [],
      hiddenFolders: Array.isArray(parsed.hiddenFolders) ? parsed.hiddenFolders : [],
      hiddenFiles: Array.isArray(parsed.hiddenFiles) ? parsed.hiddenFiles : [],
    };
  } catch {
    return emptyIndex();
  }
}

async function saveIndex(index) {
  await mkdir(ROOT, { recursive: true });
  const temp = path.join(ROOT, `index.${process.pid}.tmp`);
  await writeFile(temp, JSON.stringify(index));
  await rename(temp, INDEX);
}

function blobPath(id) {
  return path.join(BLOBS, id);
}

function baseProducts() {
  return [...catalogProducts.filter((product) => product.kind !== "app"), ...listAppProducts()];
}

function tabKind(tab) {
  const kind = TAB_KIND[tab];
  if (!kind) throw new AppError("Bu sekmede klasör açılamaz.", "VALIDATION", 400);
  return kind;
}

function productMatches(product, kind) {
  if (kind === "game") return product.kind === "game";
  if (kind === "aso") return product.kind === "aso";
  return product.kind !== "game" && product.kind !== "aso";
}

function cleanName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new AppError("Klasör adı gerekli.", "VALIDATION", 400);
  if (name.length > 80) throw new AppError("Klasör adı çok uzun.", "VALIDATION", 400);
  if (name === "." || name === ".." || /[\\/\u0000]/.test(name)) {
    throw new AppError("Klasör adı geçersiz.", "VALIDATION", 400);
  }
  return name;
}

function safeSegment(value) {
  const name = String(value ?? "").trim();
  if (!name || name.length > 200 || name === "." || name === ".." || /[\\/\u0000]/.test(name)) {
    throw new AppError("Klasör bulunamadı.", "NOT_FOUND", 404);
  }
  return name;
}

function cleanFileName(value) {
  const base = path.basename(String(value ?? "").replace(/\\/g, "/")).replace(/\s+/g, " ").trim();
  if (!base || base === "." || base === ".." || base.length > 120 || /[\u0000]/.test(base)) {
    throw new AppError("Dosya adı geçersiz.", "VALIDATION", 400);
  }
  return base;
}

function lower(value) {
  return value.toLocaleLowerCase("tr");
}

function joinPath(segments) {
  return segments.filter(Boolean).join(" / ");
}

function hideCovers(index, productId, folderPath) {
  if (!folderPath) return false;
  return index.hiddenFolders.some((item) => item.productId === productId && (folderPath === item.path || folderPath.startsWith(`${item.path} / `)));
}

function fileIsHidden(index, productId, file) {
  if (index.hiddenFiles.some((item) => item.url === file.url)) return true;
  return hideCovers(index, productId, file.folder || "");
}

function userFileVisible(index, productId, folderPath) {
  if (!folderPath || !hideCovers(index, productId, folderPath)) return true;
  return index.folders.some((folder) => folder.productId === productId && (folder.path === folderPath || folderPath.startsWith(`${folder.path} / `)));
}

function folderExists(product, folderPath, index) {
  if (!folderPath) return !index.hiddenProducts.includes(product.id);
  const nested = `${folderPath} / `;
  if (index.folders.some((folder) => folder.productId === product.id && (folder.path === folderPath || folder.path.startsWith(nested)))) {
    return true;
  }
  if (hideCovers(index, product.id, folderPath)) return false;
  if (index.files.some((file) => file.productId === product.id && ((file.folder || "") === folderPath || (file.folder || "").startsWith(nested)))) {
    return true;
  }
  return product.files.some((file) => !fileIsHidden(index, product.id, file) && (file.folder === folderPath || (file.folder || "").startsWith(nested)));
}

function childFolderName(product, parentPath, name, index) {
  const prefix = parentPath ? `${parentPath} / ` : "";
  const want = lower(name);
  const paths = [];
  for (const folder of index.folders) {
    if (folder.productId === product.id) paths.push(folder.path);
  }
  for (const file of index.files) {
    if (file.productId === product.id && file.folder) paths.push(file.folder);
  }
  for (const file of product.files) {
    if (!fileIsHidden(index, product.id, file) && file.folder) paths.push(file.folder);
  }
  for (const folder of paths) {
    if (parentPath && folder !== parentPath && !folder.startsWith(prefix)) continue;
    if (hideCovers(index, product.id, folder) && !index.folders.some((item) => item.productId === product.id && item.path === folder)) continue;
    const rest = parentPath ? folder.slice(prefix.length) : folder;
    const next = rest.split(" / ")[0];
    if (next && lower(next) === want) return next;
  }
  return "";
}

function siblingNames(product, parentPath, index) {
  const names = new Set();
  const prefix = parentPath ? `${parentPath} / ` : "";
  function addFrom(folder) {
    if (parentPath) {
      if (folder === parentPath) return;
      if (!folder.startsWith(prefix)) return;
      const next = folder.slice(prefix.length).split(" / ")[0];
      if (next) names.add(lower(next));
      return;
    }
    const next = folder.split(" / ")[0];
    if (next) names.add(lower(next));
  }
  for (const file of product.files) {
    if (fileIsHidden(index, product.id, file)) continue;
    const folder = file.folder || "";
    if (folder === parentPath) names.add(lower(file.name));
    if (folder) addFrom(folder);
  }
  for (const folder of index.folders) {
    if (folder.productId === product.id) addFrom(folder.path);
  }
  for (const file of index.files) {
    if (file.productId !== product.id) continue;
    const folder = file.folder || "";
    if (folder === parentPath) names.add(lower(file.name));
    if (folder) addFrom(folder);
  }
  return names;
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
    const mark = bytes.subarray(0, 6).toString("latin1");
    return mark === "GIF87a" || mark === "GIF89a";
  }
  if (check === "webp") return bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
  if (check === "heif") return bytes.length >= 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp";
  if (check === "text") return !bytes.subarray(0, 4096).includes(0);
  return false;
}

function uniqueName(name, taken) {
  if (!taken.has(lower(name))) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let count = 2;
  let next = `${stem} (${count})${ext}`;
  while (taken.has(lower(next))) {
    count += 1;
    next = `${stem} (${count})${ext}`;
  }
  return next;
}

export function mergeUserLibrary(base) {
  const index = readIndex();
  const byId = new Map(base.map((product) => [product.id, {
    ...product,
    files: product.files.map((file) => ({ ...file })),
    folders: [],
  }]));
  const userIds = [];
  for (const root of index.roots) {
    if (!root || typeof root.id !== "string" || typeof root.name !== "string") continue;
    if (root.kind !== "app" && root.kind !== "game" && root.kind !== "aso") continue;
    if (!byId.has(root.id)) {
      byId.set(root.id, { id: root.id, name: root.name, kind: root.kind, files: [], folders: [] });
      userIds.push(root.id);
    }
  }
  for (const folder of index.folders) {
    const product = byId.get(folder.productId);
    if (product && typeof folder.path === "string" && folder.path) product.folders.push(folder.path);
  }
  for (const file of index.files) {
    const product = byId.get(file.productId);
    if (!product || typeof file.id !== "string" || typeof file.name !== "string") continue;
    product.files.push({
      name: file.name,
      folder: file.folder || "",
      url: `/api/urun-dosya/user/${file.id}`,
      image: Boolean(file.image),
      user: true,
    });
  }
  for (const product of byId.values()) {
    product.files = product.files.filter((file) => file.user ? userFileVisible(index, product.id, file.folder || "") : !fileIsHidden(index, product.id, file));
  }
  const hidden = new Set(index.hiddenProducts);
  const created = userIds.filter((id) => !hidden.has(id)).map((id) => byId.get(id));
  const rest = base.map((product) => byId.get(product.id)).filter((product) => product && !hidden.has(product.id));
  return [...created, ...rest];
}

export async function openUserFile(fileId) {
  if (!/^[a-f0-9]{32}$/.test(fileId || "")) {
    throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  }
  const file = readIndex().files.find((item) => item.id === fileId);
  if (!file) throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  const ext = path.extname(file.name).slice(1).toLowerCase();
  const spec = TYPES[ext];
  if (!spec) throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  try {
    const bytes = await readFile(blobPath(fileId));
    return {
      bytes,
      contentType: spec.mime,
      fileName: file.name,
      inline: Boolean(spec.image) || spec.mime === "application/pdf",
    };
  } catch {
    throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  }
}

function findOwnedProduct(index, tab, productId) {
  const kind = tabKind(tab);
  const base = baseProducts().find((product) => product.id === productId);
  const root = index.roots.find((item) => item.id === productId);
  const product = base || (root ? { id: root.id, name: root.name, kind: root.kind, files: [] } : null);
  if (!product || !productMatches(product, kind)) {
    throw new AppError("Klasör bulunamadı.", "NOT_FOUND", 404);
  }
  return product;
}

export function createUserFolder(tab, productId, segments, rawName) {
  return locked(async () => {
    const name = cleanName(rawName);
    const index = readIndex();
    const kind = tabKind(tab);
    const parent = Array.isArray(segments) ? segments.map((segment) => safeSegment(segment)) : [];
    if (parent.length >= MAX_DEPTH) throw new AppError("Klasör çok derin.", "VALIDATION", 400);

    if (!productId) {
      const taken = new Set();
      for (const product of baseProducts()) {
        if (productMatches(product, kind) && !index.hiddenProducts.includes(product.id)) taken.add(lower(product.name));
      }
      for (const root of index.roots) {
        if (root.kind === kind) taken.add(lower(root.name));
      }
      if (taken.has(lower(name))) throw new AppError("Bu ada sahip bir klasör zaten var.", "VALIDATION", 400);
      const id = `u${randomBytes(8).toString("hex")}`;
      index.roots.unshift({ id, name, kind });
      await saveIndex(index);
      return { id, name };
    }

    const product = findOwnedProduct(index, tab, productId);
    const parentPath = joinPath(parent);
    if (!folderExists(product, parentPath, index)) {
      throw new AppError("Klasör bulunamadı.", "NOT_FOUND", 404);
    }
    const taken = siblingNames(product, parentPath, index);
    if (taken.has(lower(name))) throw new AppError("Bu ada sahip bir öğe zaten var.", "VALIDATION", 400);
    index.folders.push({ productId: product.id, path: joinPath([...parent, name]) });
    await saveIndex(index);
    return { id: product.id, name };
  });
}

export function addUserFiles(tab, productId, segments, uploads) {
  return locked(async () => {
    const index = readIndex();
    const product = findOwnedProduct(index, tab, productId);
    const parent = Array.isArray(segments) ? segments.map((segment) => safeSegment(segment)) : [];
    const parentPath = joinPath(parent);
    if (!folderExists(product, parentPath, index)) {
      throw new AppError("Klasör bulunamadı.", "NOT_FOUND", 404);
    }
    const list = Array.isArray(uploads) ? uploads : [];
    if (list.length === 0) throw new AppError("Dosya seçin.", "VALIDATION", 400);
    if (list.length > MAX_FILES) throw new AppError("Bir seferde en fazla 10 dosya yüklenebilir.", "VALIDATION", 400);

    const accepted = [];
    const rejected = [];
    for (const upload of list) {
      const name = cleanFileName(upload.name);
      const ext = path.extname(name).slice(1).toLowerCase();
      const spec = TYPES[ext];
      if (!spec) {
        rejected.push(name);
        continue;
      }
      if (!upload.bytes || upload.bytes.length === 0) {
        rejected.push(name);
        continue;
      }
      if (upload.bytes.length > MAX_BYTES) {
        throw new AppError(`${name} 20 MB sınırını aşıyor.`, "VALIDATION", 400);
      }
      if (!matches(spec.check, upload.bytes)) {
        rejected.push(name);
        continue;
      }
      accepted.push({ name, bytes: upload.bytes, image: Boolean(spec.image) });
    }
    if (accepted.length === 0) {
      throw new AppError("Bu dosya türü desteklenmiyor. PDF, Word, Excel, PowerPoint veya fotoğraf yükleyin.", "VALIDATION", 400);
    }

    const taken = siblingNames(product, parentPath, index);
    const written = [];
    try {
      await mkdir(BLOBS, { recursive: true });
      for (const file of accepted) {
        const name = uniqueName(file.name, taken);
        taken.add(lower(name));
        const id = randomBytes(16).toString("hex");
        await writeFile(blobPath(id), file.bytes, { flag: "wx" });
        written.push({ id, productId: product.id, folder: parentPath, name, image: file.image });
      }
      index.files.push(...written);
      await saveIndex(index);
    } catch (error) {
      await Promise.all(written.map((file) => rm(blobPath(file.id), { force: true })));
      throw error;
    }

    const message = rejected.length
      ? `${written.length} dosya eklendi. Kabul edilmedi: ${rejected.join(", ")}`
      : written.length === 1 ? "Dosya eklendi." : `${written.length} dosya eklendi.`;
    return { message };
  });
}

function ensureFolder(index, product, segments) {
  const folderPath = joinPath(segments);
  if (!folderPath || folderExists(product, folderPath, index)) return;
  index.folders.push({ productId: product.id, path: folderPath });
}

export function prepareFolderImport(tab, productId, segments, rootName, nested) {
  return locked(async () => {
    const name = cleanName(rootName);
    const index = readIndex();
    const parent = Array.isArray(segments) ? segments.map((segment) => safeSegment(segment)) : [];
    const extra = Array.isArray(nested) ? nested.map((folder) => String(folder ?? "").split(" / ").filter(Boolean).map((segment) => safeSegment(segment))) : [];
    const deepest = extra.reduce((max, parts) => Math.max(max, parts.length), 0);
    if (parent.length + 1 + deepest > MAX_DEPTH) throw new AppError("Klasör çok derin.", "VALIDATION", 400);

    let id = productId || "";
    let placed = name;
    if (!id) {
      const kind = tabKind(tab);
      const existing = [...baseProducts(), ...index.roots.map((root) => ({ id: root.id, name: root.name, kind: root.kind, files: [] }))]
        .find((product) => productMatches(product, kind) && !index.hiddenProducts.includes(product.id) && lower(product.name) === lower(name));
      if (existing) {
        id = existing.id;
      } else {
        id = `u${randomBytes(8).toString("hex")}`;
        index.roots.unshift({ id, name, kind });
      }
      const product = findOwnedProduct(index, tab, id);
      for (const parts of extra) {
        parts.forEach((_, depth) => ensureFolder(index, product, parts.slice(0, depth + 1)));
      }
      await saveIndex(index);
      return { id, name: placed };
    }

    const product = findOwnedProduct(index, tab, id);
    const parentPath = joinPath(parent);
    if (!folderExists(product, parentPath, index)) throw new AppError("Klasör bulunamadı.", "NOT_FOUND", 404);
    const current = childFolderName(product, parentPath, name, index);
    if (current) {
      placed = current;
    } else {
      const taken = siblingNames(product, parentPath, index);
      if (taken.has(lower(name))) placed = uniqueName(name, taken);
      ensureFolder(index, product, [...parent, placed]);
    }
    for (const parts of extra) {
      parts.forEach((_, depth) => ensureFolder(index, product, [...parent, placed, ...parts.slice(0, depth + 1)]));
    }
    await saveIndex(index);
    return { id, name: placed };
  });
}

function rememberHide(list, item, same) {
  if (!list.some((current) => same(current, item))) list.push(item);
}

export function deleteLibraryEntry(tab, productId, segments, fileUrl) {
  return locked(async () => {
    const index = readIndex();
    const product = findOwnedProduct(index, tab, productId);
    const parent = Array.isArray(segments) ? segments.map((segment) => safeSegment(segment)) : [];

    if (fileUrl) {
      const url = String(fileUrl);
      const userId = url.startsWith("/api/urun-dosya/user/") ? url.slice("/api/urun-dosya/user/".length) : "";
      const stored = index.files.find((file) => file.productId === product.id && file.id === userId);
      if (stored) {
        index.files = index.files.filter((file) => file.id !== stored.id);
        await saveIndex(index);
        await rm(blobPath(stored.id), { force: true });
        return { message: "Dosya silindi." };
      }
      if (!product.files.some((file) => file.url === url)) throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
      rememberHide(index.hiddenFiles, { productId: product.id, url }, (current, item) => current.url === item.url);
      await saveIndex(index);
      return { message: "Dosya silindi." };
    }

    if (parent.length === 0) {
      const stored = index.files.filter((file) => file.productId === product.id);
      index.files = index.files.filter((file) => file.productId !== product.id);
      index.folders = index.folders.filter((folder) => folder.productId !== product.id);
      index.hiddenFolders = index.hiddenFolders.filter((folder) => folder.productId !== product.id);
      index.hiddenFiles = index.hiddenFiles.filter((file) => file.productId !== product.id);
      const owned = index.roots.some((root) => root.id === product.id);
      if (owned) index.roots = index.roots.filter((root) => root.id !== product.id);
      else rememberHide(index.hiddenProducts, product.id, (current, item) => current === item);
      await saveIndex(index);
      await Promise.all(stored.map((file) => rm(blobPath(file.id), { force: true })));
      return { message: "Klasör silindi." };
    }

    const folderPath = joinPath(parent);
    if (!folderExists(product, folderPath, index)) throw new AppError("Klasör bulunamadı.", "NOT_FOUND", 404);
    const nested = `${folderPath} / `;
    const stored = index.files.filter((file) => file.productId === product.id && ((file.folder || "") === folderPath || (file.folder || "").startsWith(nested)));
    index.files = index.files.filter((file) => !stored.includes(file));
    index.folders = index.folders.filter((folder) => folder.productId !== product.id || !(folder.path === folderPath || folder.path.startsWith(nested)));
    rememberHide(index.hiddenFolders, { productId: product.id, path: folderPath }, (current, item) => current.productId === item.productId && current.path === item.path);
    await saveIndex(index);
    await Promise.all(stored.map((file) => rm(blobPath(file.id), { force: true })));
    return { message: "Klasör silindi." };
  });
}

export function assertProductVisible(urlPath) {
  const index = readIndex();
  const targets = new Set([urlPath]);
  try {
    targets.add(decodeURI(urlPath));
  } catch {
    targets.add(urlPath);
  }
  if (index.hiddenFiles.some((item) => targets.has(item.url))) {
    throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  }
  for (const product of baseProducts()) {
    for (const file of product.files) {
      if (!targets.has(file.url)) continue;
      if (index.hiddenProducts.includes(product.id) || fileIsHidden(index, product.id, file)) {
        throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
      }
    }
  }
}
