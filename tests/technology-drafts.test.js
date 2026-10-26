import { describe, expect, it } from "vitest";
import { TECHNOLOGY_DRAFTS, technologyDraft } from "@/server/technology/drafts";

describe("hizmet taslakları", () => {
  it("kayıtlı hizmetler taslak listesinde durmaz", () => {
    expect(TECHNOLOGY_DRAFTS).toEqual([]);
    expect(technologyDraft("cursor-pro")).toBeNull();
    expect(technologyDraft("rive")).toBeNull();
  });
});
