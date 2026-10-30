export const COMMENT_EMOJIS = ["👍", "❤️", "😄", "🎉", "✅", "👀", "🙏", "🔥"];

export function groupCommentReactions(rows, viewerId) {
  const groups = new Map();
  for (const row of rows ?? []) {
    if (!row?.emoji) continue;
    const current = groups.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false, names: [] };
    current.count += 1;
    if (row.userId === viewerId) current.mine = true;
    if (row.userName) current.names.push(row.userName);
    groups.set(row.emoji, current);
  }
  return [...groups.values()];
}
