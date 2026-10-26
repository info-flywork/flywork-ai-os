"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { addWorkComment, addWorkImage, addWorkLink, createWorkSpace, deleteWorkImage, deleteWorkLink, deleteWorkTask, moveWorkTask, saveWorkTask, setWorkTaskCompleted } from "@/server/services/work";

export type TaskActionState = { ok: boolean; message: string; id?: string };

function finish(error: unknown): TaskActionState {
  unstable_rethrow(error);
  return { ok: false, message: toPublicError(error).message };
}

export async function createSpaceAction(input: unknown): Promise<TaskActionState> {
  try {
    const actor = await requireUser();
    const created = await createWorkSpace(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Alan eklendi.", id: created.id };
  } catch (error) {
    return finish(error);
  }
}

export async function saveTaskAction(input: unknown): Promise<TaskActionState> {
  try {
    const actor = await requireUser();
    const record = input && typeof input === "object" ? input as { id?: string } : {};
    await saveWorkTask(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: record.id ? "Kart güncellendi." : "Kart eklendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function moveTaskAction(input: unknown): Promise<TaskActionState> {
  try {
    const actor = await requireUser();
    await moveWorkTask(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Kart taşındı." };
  } catch (error) {
    return finish(error);
  }
}

export async function setTaskCompletedAction(input: unknown): Promise<TaskActionState> {
  try {
    const actor = await requireUser();
    await setWorkTaskCompleted(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Kart güncellendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function addCommentAction(input: unknown): Promise<TaskActionState> {
  try {
    const actor = await requireUser();
    await addWorkComment(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Yorum eklendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function addLinkAction(input: unknown): Promise<TaskActionState> {
  try {
    const actor = await requireUser();
    await addWorkLink(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Link eklendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function removeLinkAction(id: string): Promise<TaskActionState> {
  try {
    const actor = await requireUser();
    await deleteWorkLink(actor, id);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Link silindi." };
  } catch (error) {
    return finish(error);
  }
}

export async function addImageAction(formData: FormData): Promise<TaskActionState> {
  try {
    const actor = await requireUser();
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, message: "Görsel seçin." };
    await addWorkImage(actor, String(formData.get("taskId") ?? ""), Buffer.from(await file.arrayBuffer()));
    revalidatePath("/is-takibi");
    return { ok: true, message: "Görsel eklendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function removeImageAction(id: string): Promise<TaskActionState> {
  try {
    const actor = await requireUser();
    await deleteWorkImage(actor, id);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Görsel silindi." };
  } catch (error) {
    return finish(error);
  }
}

export async function deleteTaskAction(id: string): Promise<TaskActionState> {
  try {
    const actor = await requireUser();
    await deleteWorkTask(actor, id);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Kart silindi." };
  } catch (error) {
    return finish(error);
  }
}
