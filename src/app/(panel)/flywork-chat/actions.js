"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { mirrorChatToTelegram } from "@/server/telegram/chatBridge";
import { toPublicError } from "@/server/errors";
import {
  addChatMembers,
  createGroupChat,
  deleteChatMessage,
  deleteChatThread,
  editChatMessage,
  leaveChat,
  loadChatThread,
  openDirectChat,
  sendChatMessage,
  setChatFlags,
  setGroupPhoto,
  setOwnProfile,
  toggleChatReaction,
  togglePinnedChatMessage,
  updateGroupChat,
} from "@/server/services/chat";

function finish(error) {
  unstable_rethrow(error);
  return { ok: false, message: toPublicError(error).message };
}

function refresh() {
  revalidatePath("/flywork-chat");
  revalidatePath("/", "layout");
}

async function filesFrom(form) {
  const files = [];
  for (const file of form.getAll("image")) {
    if (file instanceof File && file.size > 0) {
      files.push({ bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name, kind: "image" });
    }
  }
  for (const file of form.getAll("file")) {
    if (file instanceof File && file.size > 0) {
      files.push({ bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name, kind: "file" });
    }
  }
  return files;
}

function photoFrom(form) {
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  return file.arrayBuffer().then((buffer) => Buffer.from(buffer));
}

export async function saveProfileAction(form) {
  try {
    const actor = await requireUser();
    await setOwnProfile(actor, {
      bio: String(form.get("bio") ?? ""),
      removePhoto: form.get("removePhoto") === "1",
      photo: await photoFrom(form),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}

export async function saveGroupPhotoAction(form) {
  try {
    const actor = await requireUser();
    await setGroupPhoto(actor, {
      threadId: String(form.get("threadId") ?? ""),
      removePhoto: form.get("removePhoto") === "1",
      photo: await photoFrom(form),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}

export async function loadThreadAction(threadId, markRead = true) {
  try {
    const actor = await requireUser();
    const open = await loadChatThread(actor, threadId, markRead);
    return { ok: true, open };
  } catch (error) {
    return finish(error);
  }
}

export async function sendChatAction(form) {
  try {
    const actor = await requireUser();
    const created = await sendChatMessage(actor, {
      threadId: String(form.get("threadId") ?? ""),
      body: String(form.get("body") ?? ""),
      replyToId: String(form.get("replyToId") ?? ""),
      files: await filesFrom(form),
    });
    try {
      await mirrorChatToTelegram(created.id);
    } catch {
      // Panel mesajı durur. Telegram gönderimi ayrıca yeniden denenmez.
    }
    return { ok: true, id: created.id };
  } catch (error) {
    return finish(error);
  }
}

export async function openDirectAction(userId) {
  try {
    const actor = await requireUser();
    const created = await openDirectChat(actor, userId);
    refresh();
    return { ok: true, id: created.id };
  } catch (error) {
    return finish(error);
  }
}

export async function createGroupAction(input) {
  try {
    const actor = await requireUser();
    const created = await createGroupChat(actor, input);
    refresh();
    return { ok: true, id: created.id };
  } catch (error) {
    return finish(error);
  }
}

export async function updateGroupAction(input) {
  try {
    const actor = await requireUser();
    await updateGroupChat(actor, input);
    refresh();
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}

export async function addMembersAction(input) {
  try {
    const actor = await requireUser();
    await addChatMembers(actor, input);
    refresh();
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}

export async function leaveChatAction(threadId) {
  try {
    const actor = await requireUser();
    await leaveChat(actor, threadId);
    refresh();
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}

export async function setChatFlagsAction(input) {
  try {
    const actor = await requireUser();
    await setChatFlags(actor, input);
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}

export async function editChatAction(input) {
  try {
    const actor = await requireUser();
    await editChatMessage(actor, input);
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}

export async function deleteThreadAction(threadId) {
  try {
    const actor = await requireUser();
    await deleteChatThread(actor, threadId);
    refresh();
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}

export async function deleteChatAction(messageId) {
  try {
    const actor = await requireUser();
    await deleteChatMessage(actor, messageId);
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}

export async function reactChatAction(input) {
  try {
    const actor = await requireUser();
    await toggleChatReaction(actor, input);
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}

export async function pinMessageAction(messageId) {
  try {
    const actor = await requireUser();
    await togglePinnedChatMessage(actor, messageId);
    return { ok: true };
  } catch (error) {
    return finish(error);
  }
}
