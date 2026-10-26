 








export const TECHNOLOGY_DRAFTS = [];

export function technologyDraft(id) {
  if (!id) {
    return null;
  }
  return TECHNOLOGY_DRAFTS.find((draft) => draft.id === id) ?? null;
}
