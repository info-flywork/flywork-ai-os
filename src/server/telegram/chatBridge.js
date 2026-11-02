import "server-only";
import { can } from "@/server/auth/permissions";
import { withDatabase } from "@/server/db";
import { toPublicError } from "@/server/errors";
import { sendChatMessage } from "@/server/services/chat";
import { postTelegram, downloadTelegramFile } from "@/server/telegram/client";
import { telegramBotToken, telegramStatus } from "@/server/telegram/config";
import { inspectWorkImage } from "@/server/work/images";

export function formatChatTelegramText(input) {
  const files = input.files.length > 0 ? `\nEk: ${input.files.join(", ")}` : "";
  const head = input.kind === "DIRECT"
    ? `Flywork Chat · ${input.authorName}`
    : `Flywork Chat · ${input.title || "Sohbet"}\n${input.authorName}:`;
  const text = `${head}\n${input.body}${files}`.trim();
  return text.length > 4000 ? `${text.slice(0, 3990)}…` : text;
}

export async function mirrorChatToTelegram(messageId) {
  const token = telegramBotToken();
  if (telegramStatus().delivery !== "live" || !token) return;
  await withDatabase(async (db) => {
    const message = await db.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        body: true,
        deletedAt: true,
        author: { select: { id: true, name: true } },
        thread: { select: { id: true, kind: true, title: true } },
        attachments: { select: { fileName: true } },
      },
    });
    if (!message || message.deletedAt) return;
    const members = await db.chatMember.findMany({
      where: { threadId: message.thread.id, leftAt: null, userId: { not: message.author.id }, muted: false },
      select: { userId: true },
    });
    if (members.length === 0) return;
    const links = await db.telegramLink.findMany({
      where: { userId: { in: members.map((member) => member.userId) }, revokedAt: null },
      select: { userId: true, chatId: true },
    });
    const text = formatChatTelegramText({
      kind: message.thread.kind,
      title: message.thread.title,
      authorName: message.author.name,
      body: message.body,
      files: message.attachments.map((file) => file.fileName),
    });
    for (const link of links) {
      const saved = await db.chatTelegramCopy.findFirst({
        where: { messageId: message.id, telegramChatId: link.chatId },
        select: { id: true },
      });
      if (saved) continue;
      const sent = await postTelegram("sendMessage", { chat_id: link.chatId, text }, { token });
      if (!sent.ok || !sent.messageId) continue;
      await db.chatTelegramCopy.create({
        data: {
          messageId: message.id,
          telegramChatId: link.chatId,
          telegramMessageId: sent.messageId,
        },
      }).catch(() => {});
    }
  });
}

async function chatActor(db, telegramUserId, chatId) {
  const link = await db.telegramLink.findUnique({
    where: { telegramUserId },
    include: { user: { select: { id: true, role: true, name: true, active: true, mealOnly: true } } },
  });
  if (!link || link.revokedAt || link.chatId !== chatId || !link.user.active || link.user.mealOnly) return null;
  if (!can(link.user.role, "chat:use")) return null;
  return link.user;
}

async function chatCopy(db, input) {
  if (input.replyToTelegramMessageId) {
    const exact = await db.chatTelegramCopy.findUnique({
      where: {
        telegramChatId_telegramMessageId: {
          telegramChatId: input.chatId,
          telegramMessageId: input.replyToTelegramMessageId,
        },
      },
      select: { message: { select: { id: true, threadId: true, deletedAt: true } } },
    });
    if (exact) return exact;
  }
  return db.chatTelegramCopy.findFirst({
    where: { telegramChatId: input.chatId, message: { deletedAt: null } },
    orderBy: { createdAt: "desc" },
    select: { message: { select: { id: true, threadId: true, deletedAt: true } } },
  });
}

export async function acceptTelegramChatReply(input) {
  const spoken = (input.text ?? "").trim();
  if (!spoken && !input.photoFileId) return null;
  const copy = await withDatabase((db) => chatCopy(db, input));
  if (!copy) return null;
  if (copy.message.deletedAt) return "Bu mesaj panelde silinmiş.";
  const actor = await withDatabase((db) => chatActor(db, input.telegramUserId, input.chatId));
  if (!actor) return "Bu Telegram hesabı panele bağlı değil.";
  const files = [];
  if (input.photoFileId) {
    const token = telegramBotToken();
    if (!token) return "Telegram görseli alınamadı.";
    const file = await downloadTelegramFile(input.photoFileId, { token });
    if (!file.ok) return file.error;
    try {
      const image = inspectWorkImage(file.bytes);
      files.push({ kind: "image", bytes: image.bytes, fileName: "telegram.jpg" });
    } catch (error) {
      return toPublicError(error).message;
    }
  }
  try {
    const created = await sendChatMessage(actor, {
      threadId: copy.message.threadId,
      body: spoken,
      replyToId: copy.message.id,
      files,
    });
    await mirrorChatToTelegram(created.id);
    return "Panele yazıldı.";
  } catch (error) {
    return toPublicError(error).message;
  }
}
