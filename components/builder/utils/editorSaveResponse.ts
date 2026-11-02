/** Parsed PATCH /api/templates/[id] error body (when JSON). */
export type SaveResponseBody = { error?: string } | null;

/** `null` = success; otherwise the user-facing save error. */
export const editorSaveErrorFromResponse = (
  ok: boolean,
  status: number,
  body: SaveResponseBody,
): string | null => {
  if (ok && !body?.error) return null;
  if (body?.error) return body.error;
  return `Failed to save the draft (${status}) — try again.`;
};

/** After Save, only replace the local draft when no edits landed during the request. */
export const shouldAdoptServerDraftAfterSave = (
  generationAtStart: number,
  generationNow: number,
): boolean => generationAtStart === generationNow;
