
import { withDatabase } from "@/server/db";
import { formatFeedbackNotice } from "@/server/telegram/messages";
import { deliverTelegram, liveTelegramTransport } from "@/server/telegram/send";




export async function notifyFeedback(noteId, channel = liveTelegramTransport()) {
  try {
    return await withDatabase(async (db) => sendFeedback(db, noteId, channel));
  } catch {
    return false;
  }
}

async function sendFeedback(db, noteId, channel) {
  const note = await db.feedbackNote.findUnique({
    where: { id: noteId },
    select: {
      id: true,
      kind: true,
      body: true,
      user: { select: { name: true } },
    },
  });
  if (!note) {
    return false;
  }
  const admins = await db.telegramLink.findMany({
    where: { revokedAt: null, user: { role: "ADMIN", active: true, approver: true } },
    select: { userId: true, chatId: true },
  });
  if (admins.length === 0) {
    return false;
  }
  const text = formatFeedbackNotice({
    kind: note.kind,
    authorName: note.user.name,
    body: note.body,
  });
  let sent = false;
  for (const admin of admins) {
    const result = await deliverTelegram(db, {
      dedupeKey: `feedback.note:${note.id}:${admin.userId}`,
      kind: "feedback.note",
      chatId: admin.chatId,
      text,
      delivery: channel.delivery,
      transport: channel.transport,
    });
    sent = sent || result.status === "sent";
  }
  return sent;
}
