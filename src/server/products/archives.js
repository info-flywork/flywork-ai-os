import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

const ARCHIVE_ROOT = path.join(process.cwd(), "storage", "products", "archives");

let loaded;

function load() {
  if (loaded) return loaded;
  let apps = [];
  try {
    apps = JSON.parse(readFileSync(path.join(ARCHIVE_ROOT, "apps.json"), "utf8"));
  } catch {
    apps = [];
  }
  const entries = new Map();
  const products = apps.map((app) => ({
    id: app.id,
    name: app.name,
    kind: "app",
    files: app.files.map((file) => {
      entries.set(`${file.zip}\0${file.member.join("/")}`, file);
      return {
        name: file.name,
        folder: file.folder,
        url: `/api/urun-dosya/arsiv/${[file.zip, ...file.member].map((part) => encodeURIComponent(part)).join("/")}`,
        image: file.image,
      };
    }),
  }));
  loaded = { products, entries };
  return loaded;
}

export function listAppProducts() {
  return load().products;
}

export function findArchiveEntry(zipId, member) {
  const entry = load().entries.get(`${zipId}\0${member}`);
  if (!entry) return null;
  return { ...entry, zipPath: path.join(ARCHIVE_ROOT, `apps-${zipId}.zip`) };
}
