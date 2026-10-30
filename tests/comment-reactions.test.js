import { describe, expect, it } from "vitest";

import { groupCommentReactions } from "../src/lib/commentReactions.js";

describe("comment reactions", () => {
  it("groups the same emoji and marks the viewer's own reaction", () => {
    const groups = groupCommentReactions([
      { emoji: "👍", userId: "tuna", userName: "Tunahan" },
      { emoji: "👍", userId: "sena", userName: "Sena" },
      { emoji: "🎉", userId: "sena", userName: "Sena" },
    ], "tuna");
    expect(groups).toEqual([
      { emoji: "👍", count: 2, mine: true, names: ["Tunahan", "Sena"] },
      { emoji: "🎉", count: 1, mine: false, names: ["Sena"] },
    ]);
  });
});