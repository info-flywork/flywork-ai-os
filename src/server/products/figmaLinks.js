import "server-only";

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/server/errors";
import { listAppProducts } from "@/server/products/archives";
import { products as catalogProducts } from "@/server/products/catalog";

const FILE = path.join(process.cwd(), "storage", "products", "user", "figma.json");

let queue = Promise.resolve();

function locked(task) {
  const run = queue.then(task, task);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function readLinks() {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    return Array.isArray(parsed.links) ? parsed.links : [];
  } catch {
    return [];
  }
}

async function saveLinks(links) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const temp = path.join(path.dirname(FILE), `figma.${process.pid}.tmp`);
  await writeFile(temp, JSON.stringify({ links }));
  await rename(temp, FILE);
}

function cleanName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new AppError("Uygulama adı gerekli.", "VALIDATION", 400);
  if (name.length > 80) throw new AppError("Uygulama adı çok uzun.", "VALIDATION", 400);
  return name;
}

function figmaUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new AppError("Figma linki geçersiz.", "VALIDATION", 400);
  }
  if (url.protocol !== "https:") throw new AppError("Figma linki https olmalı.", "VALIDATION", 400);
  const host = url.hostname.toLocaleLowerCase("en");
  if (host !== "figma.com" && !host.endsWith(".figma.com")) {
    throw new AppError("Link bir Figma adresi olmalı.", "VALIDATION", 400);
  }
  return url.toString();
}

function areaOf(value) {
  if (value === "design") return "design";
  if (value === "flow") return "flow";
  throw new AppError("Bölüm bulunamadı.", "VALIDATION", 400);
}

export function listApplicationNames() {
  const names = new Set();
  for (const product of catalogProducts) {
    if (product.kind === "game" || product.kind === "aso" || product.kind === "app") continue;
    names.add(product.name);
  }
  for (const product of listAppProducts()) names.add(product.name);
  return [...names].sort((a, b) => a.localeCompare(b, "tr"));
}

export function listFigmaLinks() {
  return readLinks()
    .filter((link) => link && (link.area === "flow" || link.area === "design") && typeof link.url === "string" && typeof link.name === "string")
    .map((link) => ({ id: link.id, name: link.name, area: link.area, url: link.url }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export function saveFigmaLink(areaName, rawName, rawUrl) {
  return locked(async () => {
    const area = areaOf(areaName);
    const name = cleanName(rawName);
    const url = figmaUrl(rawUrl);
    const links = readLinks();
    const current = links.find((link) => link.area === area && link.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"));
    if (current) {
      current.name = name;
      current.url = url;
    } else {
      links.push({ id: randomBytes(8).toString("hex"), name, area, url });
    }
    await saveLinks(links);
    return { message: current ? "Link güncellendi." : "Link eklendi." };
  });
}

export function updateFigmaLink(id, rawName, rawUrl) {
  return locked(async () => {
    const key = String(id ?? "");
    const name = cleanName(rawName);
    const url = figmaUrl(rawUrl);
    const links = readLinks();
    const current = links.find((link) => link.id === key);
    if (!current) throw new AppError("Link bulunamadı.", "NOT_FOUND", 404);
    const taken = links.some((link) => link.id !== key && link.area === current.area && link.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"));
    if (taken) throw new AppError("Bu bölümde aynı isimde bir link var.", "VALIDATION", 400);
    current.name = name;
    current.url = url;
    await saveLinks(links);
    return { message: "Link güncellendi." };
  });
}

export function removeFigmaLink(id) {
  return locked(async () => {
    const key = String(id ?? "");
    const links = readLinks();
    const next = links.filter((link) => link.id !== key);
    if (next.length === links.length) throw new AppError("Link bulunamadı.", "NOT_FOUND", 404);
    await saveLinks(next);
    return { message: "Link silindi." };
  });
}
