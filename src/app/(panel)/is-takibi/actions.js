"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import { addWorkComment, addWorkImage, addWorkLink, addWorkRevisionItems, archiveDoneWorkTasks, createWorkSpace, deleteWorkImage, deleteWorkLink, deleteWorkTask, finishWorkSession, moveWorkTask, saveWorkTask, seeWorkCard, sendTaskToReview, setRevisionItem, setWorkFocus, setWorkTaskCompleted, toggleWorkCommentReaction, updateWorkComment } from "@/server/services/work";

 

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
    const saved = await saveWorkTask(actor, input);
    revalidatePath("/is-takibi");
    return {
      ok: true,
      id: saved?.id ?? record.id ?? null,
      message: record.id ? "Kart güncellendi." : "Kart eklendi.",
    };
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
    revalidatePath("/");
    const message = status === "paused" ? "İş durduruldu." : status === "resumed" ? "İşe devam ediyorsun." : status === "started" ? "Bu işe başladın." : "Çalışan iş yok.";
    return { ok: true, message };
  } catch (error) {
    return finish(error);
  }
}

export async function sendToReviewAction(taskId) {
  try {
    const actor = await requireUser();
    await sendTaskToReview(actor, taskId);
    revalidatePath("/is-takibi");
    revalidatePath("/");
    return { ok: true, message: "Kart kontrole gönderildi." };
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

export async function addRevisionItemsAction(input) {
  try {
    const actor = await requireUser();
    await addWorkRevisionItems(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: "Kontrol listesi güncellendi." };
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
    if (input instanceof FormData) {
      const images = [];
      for (const file of input.getAll("image")) {
        if (file instanceof File && file.size > 0) {
          images.push({ bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name, kind: "image" });
        }
      }
      for (const file of input.getAll("file")) {
        if (file instanceof File && file.size > 0) {
          images.push({ bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name, kind: "file" });
        }
      }
      await addWorkComment(actor, {
        taskId: String(input.get("taskId") ?? ""),
        body: String(input.get("body") ?? ""),
        images,
      });
    } else {
      await addWorkComment(actor, input);
    }
    revalidatePath("/is-takibi");
    return { ok: true, message: "Yorum eklendi." };
  } catch (error) {
    return finish(error);
  }
}

export async function toggleCommentReactionAction(input) {
  try {
    const actor = await requireUser();
    await toggleWorkCommentReaction(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true };
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

export async function archiveDoneTasksAction(input) {
  try {
    const actor = await requireUser();
    const result = await archiveDoneWorkTasks(actor, input);
    revalidatePath("/is-takibi");
    return { ok: true, message: result.count ? `${result.count} kart arşivlendi.` : "Arşivlenecek tamamlanan kart yok.", count: result.count };
  } catch (error) {
    return finish(error);
  }
}
