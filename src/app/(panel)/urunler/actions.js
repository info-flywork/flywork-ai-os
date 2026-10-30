"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { assertNotMealOnly } from "@/server/auth/mealAccess";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { removeFigmaLink, saveFigmaLink, updateFigmaLink } from "@/server/products/figmaLinks";
import { addUserFiles, createUserFolder, deleteLibraryEntry, prepareFolderImport } from "@/server/products/userLibrary";

function finish(error) {
  unstable_rethrow(error);
  return { ok: false, message: toPublicError(error).message };
}

function segmentsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map((segment) => String(segment ?? ""));
}

export async function saveFigmaLinkAction(input) {
  try {
    const actor = await requireUser();
    assertNotMealOnly(actor);
    const record = input && typeof input === "object" ? input : {};
    const saved = await saveFigmaLink(String(record.area ?? ""), record.name, record.url);
    revalidatePath("/urunler");
    return { ok: true, message: saved.message };
  } catch (error) {
    return finish(error);
  }
}

export async function updateFigmaLinkAction(input) {
  try {
    const actor = await requireUser();
    assertNotMealOnly(actor);
    const record = input && typeof input === "object" ? input : {};
    const saved = await updateFigmaLink(record.id, record.name, record.url);
    revalidatePath("/urunler");
    return { ok: true, message: saved.message };
  } catch (error) {
    return finish(error);
  }
}

export async function deleteFigmaLinkAction(input) {
  try {
    const actor = await requireUser();
    assertNotMealOnly(actor);
    const record = input && typeof input === "object" ? input : {};
    const removed = await removeFigmaLink(record.id);
    revalidatePath("/urunler");
    return { ok: true, message: removed.message };
  } catch (error) {
    return finish(error);
  }
}

export async function createFolderAction(input) {
  try {
    const actor = await requireUser();
    assertNotMealOnly(actor);
    const record = input && typeof input === "object" ? input : {};
    const created = await createUserFolder(
      String(record.kind ?? ""),
      record.productId ? String(record.productId) : "",
      segmentsOf(record.segments),
      record.name,
    );
    revalidatePath("/urunler");
    return { ok: true, message: "Klasör eklendi.", id: created.id };
  } catch (error) {
    return finish(error);
  }
}

export async function prepareFolderImportAction(input) {
  try {
    const actor = await requireUser();
    assertNotMealOnly(actor);
    const record = input && typeof input === "object" ? input : {};
    const nested = Array.isArray(record.nested) ? record.nested.map((folder) => String(folder ?? "")) : [];
    const prepared = await prepareFolderImport(
      String(record.kind ?? ""),
      record.productId ? String(record.productId) : "",
      segmentsOf(record.segments),
      record.rootName,
      nested,
    );
    revalidatePath("/urunler");
    return { ok: true, message: "Klasör hazır.", id: prepared.id, name: prepared.name };
  } catch (error) {
    return finish(error);
  }
}

export async function deleteEntryAction(input) {
  try {
    const actor = await requireUser();
    assertNotMealOnly(actor);
    const record = input && typeof input === "object" ? input : {};
    const removed = await deleteLibraryEntry(
      String(record.kind ?? ""),
      String(record.productId ?? ""),
      segmentsOf(record.segments),
      record.fileUrl ? String(record.fileUrl) : "",
    );
    revalidatePath("/urunler");
    return { ok: true, message: removed.message };
  } catch (error) {
    return finish(error);
  }
}

export async function uploadProductFilesAction(formData) {
  try {
    const actor = await requireUser();
    assertNotMealOnly(actor);
    const kind = String(formData.get("kind") ?? "");
    const productId = String(formData.get("productId") ?? "");
    let segments = [];
    try {
      const parsed = JSON.parse(String(formData.get("segments") ?? "[]"));
      segments = segmentsOf(parsed);
    } catch {
      segments = [];
    }
    const uploads = [];
    for (const item of formData.getAll("file")) {
      if (!item || typeof item.arrayBuffer !== "function") continue;
      uploads.push({ name: item.name, bytes: Buffer.from(await item.arrayBuffer()) });
    }
    const saved = await addUserFiles(kind, productId, segments, uploads);
    revalidatePath("/urunler");
    return { ok: true, message: saved.message };
  } catch (error) {
    return finish(error);
  }
}
