import "server-only";

/** A step row's parsed `files` JSON (defensive; [] when absent/invalid).
 *  An empty list means "file ownership unknown" — the scheduler treats it as
 *  overlapping with everything (sequential), never as independence evidence. */
export const filesOf = (step: { files: string | null }): string[] => {
  if (!step.files) return [];
  try {
    const parsed = JSON.parse(step.files);
    return Array.isArray(parsed) ? parsed.filter((f: unknown) => typeof f === "string") : [];
  } catch {
    return [];
  }
};
