// Bu saatten önceki yorumlar zil çıkarmaz. Kartı açınca görülen saat bunun yerini alır.
export const COMMENT_BELL_SINCE = Date.parse("2026-10-29T21:00:00.000Z");

export function unreadCommentCount(comments, viewerId, seenAtMs = COMMENT_BELL_SINCE) {
  const since = Number.isFinite(seenAtMs) ? seenAtMs : COMMENT_BELL_SINCE;
  return comments.reduce((count, comment) => {
    if (!comment || comment.authorId === viewerId) return count;
    const at = Date.parse(comment.at);
    return Number.isFinite(at) && at > since ? count + 1 : count;
  }, 0);
}
