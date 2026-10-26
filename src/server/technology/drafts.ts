export type TechnologyDraft = {
  id: string;
  name: string;
  renewsOn: string;
  billingCycle: "YEARLY" | null;
  known: string[];
  unknown: string[];
};

export const TECHNOLOGY_DRAFTS: TechnologyDraft[] = [];

export function technologyDraft(id: string | undefined): TechnologyDraft | null {
  if (!id) {
    return null;
  }
  return TECHNOLOGY_DRAFTS.find((draft) => draft.id === id) ?? null;
}
