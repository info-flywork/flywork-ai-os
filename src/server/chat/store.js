import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/server/errors";

function rootDir() {
  return path.resolve(process.cwd(), "storage", "chat-files");
}

function resolveKey(storageKey) {
  if (!/^[a-f0-9]{32}$/.test(storageKey)) throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  const root = rootDir();
  const target = path.resolve(root, storageKey);
  if (!target.startsWith(`${root}${path.sep}`)) throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
  return target;
}

export async function writeChatFile(storageKey, bytes) {
  const target = resolveKey(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}

export async function readChatFile(storageKey) {
  try {
    return await readFile(resolveKey(storageKey));
  } catch (error) {
    if (error && error.code === "ENOENT") throw new AppError("Dosya bulunamadı.", "NOT_FOUND", 404);
    throw error;
  }
}

export async function removeChatFile(storageKey) {
  if (!/^[a-f0-9]{32}$/.test(storageKey)) return;
  await rm(resolveKey(storageKey), { force: true });
}
