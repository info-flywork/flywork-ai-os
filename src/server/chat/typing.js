import "server-only";

const TYPING_MS = 4000;
/** @type {Map<string, Map<string, { name: string, until: number }>>} */
const byThread = new Map();

function prune(threadId, now = Date.now()) {
  const row = byThread.get(threadId);
  if (!row) return;
  for (const [userId, entry] of row) {
    if (entry.until <= now) row.delete(userId);
  }
  if (row.size === 0) byThread.delete(threadId);
}

export function markTyping(threadId, userId, name) {
  if (!threadId || !userId) return;
  const now = Date.now();
  prune(threadId, now);
  let row = byThread.get(threadId);
  if (!row) {
    row = new Map();
    byThread.set(threadId, row);
  }
  row.set(userId, { name: name || "Birisi", until: now + TYPING_MS });
}

export function clearTyping(threadId, userId) {
  const row = byThread.get(threadId);
  if (!row) return;
  row.delete(userId);
  if (row.size === 0) byThread.delete(threadId);
}

export function listTyping(threadId, exceptUserId = "") {
  prune(threadId);
  const row = byThread.get(threadId);
  if (!row) return [];
  return [...row.entries()]
    .filter(([userId]) => userId !== exceptUserId)
    .map(([userId, entry]) => ({ userId, name: entry.name }));
}
