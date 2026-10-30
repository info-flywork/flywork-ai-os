import { describe, expect, it } from "vitest";
import { COMMENT_BELL_SINCE, unreadCommentCount } from "@/lib/workComments";

const viewer = "tunahan";

describe("okunmamış yorum zili", () => {
  it("başkasının yeni yorumunu sayar, kendininkini ve eskisini saymaz", () => {
    const comments = [
      { authorId: "emrah", at: "2026-10-27T09:00:00.000Z" },
      { authorId: viewer, at: "2026-10-30T08:00:00.000Z" },
      { authorId: "sena", at: "2026-10-30T08:10:00.000Z" },
    ];
    expect(unreadCommentCount(comments, viewer)).toBe(1);
  });

  it("kart açıldıktan sonraki yorumu yeniden sayar", () => {
    const comments = [
      { authorId: "sena", at: "2026-10-30T08:10:00.000Z" },
      { authorId: "emrah", at: "2026-10-30T09:00:00.000Z" },
    ];
    const seen = Date.parse("2026-10-30T08:30:00.000Z");
    expect(unreadCommentCount(comments, viewer, seen)).toBe(1);
    expect(unreadCommentCount(comments, viewer, Date.parse("2026-10-30T09:00:00.000Z"))).toBe(0);
  });

  it("eşik bugünün başıdır", () => {
    expect(new Date(COMMENT_BELL_SINCE).toISOString()).toBe("2026-10-29T21:00:00.000Z");
  });
});
