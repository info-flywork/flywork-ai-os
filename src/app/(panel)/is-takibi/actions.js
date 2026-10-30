"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { addWorkComment, addWorkImage, addWorkLink, createWorkSpace, deleteWorkImage, deleteWorkLink, deleteWorkTask, finishWorkSession, moveWorkTask, saveWorkTask, seeWorkCard, setRevisionItem, setWorkFocus, setWorkTaskCompleted, updateWorkComment } from "@/server/services/work";

 

function finish(error) {
  unstable_rethrow(error);
  return { ok: false, message: toPublicError(error).message };
}

export async function createSpaceAction(input) {
  try {
    const actor = await requireUser();
    const created = await createWorkSpace(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Alan eklendi.", id: created.id };
  } catch (error) {
    return finish(error);
  }
}

export async function saveTaskAction(input) {
  try {
    const actor = await requireUser();
    const record = input && typeof input === "object" ? input  : {};
    await saveWorkTask(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: record.id ? "Kart güncellendi." : "Kart eklendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function moveTaskAction(input) {
  try {
    const actor = await requireUser();
    await moveWorkTask(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Kart taşındı." };
  } catch (error) {
    return finish(error);
  }
}

export async function setWorkFocusAction(taskId) {
  try {
    const actor = await requireUser();
    const status = await setWorkFocus(actor, taskId || null);
    revalidatePath("/is-takibi");
    const message = status === "paused" ? "İş durduruldu." : status === "resumed" ? "İşe devam ediyorsun." : status === "started" ? "Bu işe başladın." : "Çalışan iş yok.";
    return { ok: true, message };
  } catch (error) {
    return finish(error);
  }
}

export async function finishWorkAction(taskId) {
  try {
    const actor = await requireUser();
    await finishWorkSession(actor, taskId);
    revalidatePath("/is-takibi");
    return { ok: true, message: "İş bitti." };
  } catch (error) {
    return finish(error);
  }
}

export async function setRevisionAction(input) {
  try {
    const actor = await requireUser();
    await setRevisionItem(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Revize maddesi güncellendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function setTaskCompletedAction(input) {
  try {
    const actor = await requireUser();
    await setWorkTaskCompleted(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Kart güncellendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function seeCardAction(taskId) {
  try {
    const actor = await requireUser();
    await seeWorkCard(actor, taskId);
    revalidatePath("/is-takibi");
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}

export async function addCommentAction(input) {
  try {
    const actor = await requireUser();
    await addWorkComment(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Yorum eklendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function updateCommentAction(input) {
  try {
    const actor = await requireUser();
    await updateWorkComment(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Yorum güncellendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function addLinkAction(input) {
  try {
    const actor = await requireUser();
    await addWorkLink(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Link eklendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function removeLinkAction(id) {
  try {
    const actor = await requireUser();
    await deleteWorkLink(actor, id);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Link silindi." };
  } catch (error) {
    return finish(error);
  }
}

export async function addImageAction(formData) {
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

export async function removeImageAction(id) {
  try {
    const actor = await requireUser();
    await deleteWorkImage(actor, id);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Görsel silindi." };
  } catch (error) {
    return finish(error);
  }
}

export async function deleteTaskAction(id) {
  try {
    const actor = await requireUser();
    await deleteWorkTask(actor, id);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Kart silindi." };
  } catch (error) {
    return finish(error);
  }
}
