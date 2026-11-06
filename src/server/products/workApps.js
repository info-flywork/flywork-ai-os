import "server-only";

import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/server/errors";

const FILE = path.join(process.cwd(), "storage", "products", "user", "work-apps.json");

/** Curated product apps — only these appear under Mevcut (plus Yeni uygulama customs). */
export const WORK_APPS = [
  "Friendify",
  "ChatFace",
  "Zovi",
  "Lingola Words",
  "Lingola Stories",
  "Live Lingola",
  "Lingola Buddy",
  "Lingola Job",
  "Lingola Travel",
  "Lingola Kids",
  "Lingola Daily Words",
  "Lingola Stories Kids",
  "Practigram",
  "Lingola",
  "YogiFace",
  "Slim30",
  "BreathPath",
  "SixPack30",
  "Yogify",
  "MindCoach",
  "NightFlow",
  "Fitgym",
  "Homifit",
  "Momfit",
  "Logora",
  "Aulix",
  "FileChat",
  "Dayflow",
  "SM Planner AI",
  "Video Summary",
  "File Translate",
  "Homework Snap",
  "Podora",
  "Slidify",
  "Menuma",
  "Signivo",
  "File Reader",
  "Cardiko",
  "Ten Macher",
  "Stop Point",
  "Unio",
  "Jawify",
  "Resumer",
  "Veylo",
  "MochiFast",
  "Arrow Shift",
  "Date AI",
  "Skinfy",
  "Femia",
  "Getchaty",
  "Tiny Shift",
  "Train Twist — Little Railway",
  "Traffic Tangle",
  "Pocket Factory — Mini Fabrika",
  "Knot Escape — Düğümden Kurtul",
  "INKRUN / Dashink",
];

/** ARCON AI platform modules — shown under the ARCON picker, not in Mevcut. */
export const ARCON_MODULES = [
  "Adaptly",
  "Analytica",
  "ARCON AI",
  "Arcon Club",
  "Arconnect",
  "CustomerSuccess",
  "CV Analiz",
  "Deklarasyon",
  "Draftly",
  "Görsel Üretimi",
  "HealthLingua",
  "HR - AI",
  "Kariyer",
  "LawPath",
  "Packing Modülleri",
  "PRandBrand",
  "Prim Modülü",
  "Sunum Üretici",
  "Teslim Tutanağı ve İade Yazısı",
  "Trend Market",
  "Video Size",
  "ÜTS Modülleri",
];

const WORK_APP_KEYS = new Set(WORK_APPS.map((name) => name.toLocaleLowerCase("tr")));
const ARCON_MODULE_KEYS = new Set(ARCON_MODULES.map((name) => name.toLocaleLowerCase("tr")));

/** Catch-all bucket for work that is not a product / ARCON module. */
export const OTHER_WORK_APP = "Diğer işler";

let queue = Promise.resolve();

function locked(task) {
  const run = queue.then(task, task);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function readCustomApps() {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    return Array.isArray(parsed.apps) ? parsed.apps.map((name) => String(name ?? "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function saveCustomApps(apps) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const temp = path.join(path.dirname(FILE), `work-apps.${process.pid}.tmp`);
  await writeFile(temp, JSON.stringify({ apps }));
  await rename(temp, FILE);
}

export function cleanWorkAppName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new AppError("Uygulama adı gerekli.", "VALIDATION", 400);
  if (name.length < 2) throw new AppError("Uygulama adı en az 2 karakter olmalı.", "VALIDATION", 400);
  if (name.length > 80) throw new AppError("Uygulama adı en fazla 80 karakter olabilir.", "VALIDATION", 400);
  return name;
}

export function isArconLabeled(name) {
  return /arcon/i.test(String(name ?? ""));
}

export function isArconModule(name) {
  return ARCON_MODULE_KEYS.has(String(name ?? "").toLocaleLowerCase("tr").trim());
}

export function isOtherWorkApp(name) {
  return String(name ?? "").toLocaleLowerCase("tr").trim() === OTHER_WORK_APP.toLocaleLowerCase("tr");
}

export function isKnownWorkApp(name) {
  return WORK_APP_KEYS.has(String(name ?? "").toLocaleLowerCase("tr").trim());
}

export function listArconModules() {
  return [...ARCON_MODULES];
}

export function titleMatchesApp(title, appName) {
  const hay = String(title ?? "").toLocaleLowerCase("tr");
  const needle = String(appName ?? "").toLocaleLowerCase("tr").trim();
  if (!hay || !needle) return false;
  return hay.includes(needle);
}

export function listWorkAppNames() {
  const names = new Map();
  function add(name) {
    const cleaned = String(name ?? "").replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    if (isArconLabeled(cleaned) || isArconModule(cleaned) || isOtherWorkApp(cleaned)) return;
    const key = cleaned.toLocaleLowerCase("tr");
    if (!names.has(key)) names.set(key, cleaned);
  }

  for (const name of WORK_APPS) add(name);
  for (const custom of readCustomApps()) add(custom);

  return [...names.values()].sort((left, right) => left.localeCompare(right, "tr"));
}

export async function rememberWorkApp(name) {
  const cleaned = cleanWorkAppName(name);
  if (isArconLabeled(cleaned) || isArconModule(cleaned) || isOtherWorkApp(cleaned) || isKnownWorkApp(cleaned)) {
    return cleaned;
  }
  return locked(async () => {
    const current = readCustomApps().filter((item) => !isArconLabeled(item) && !isArconModule(item) && !isOtherWorkApp(item) && !isKnownWorkApp(item));
    const key = cleaned.toLocaleLowerCase("tr");
    if (current.some((item) => item.toLocaleLowerCase("tr") === key)) return cleaned;
    await saveCustomApps([...current, cleaned].sort((left, right) => left.localeCompare(right, "tr")));
    return cleaned;
  });
}
