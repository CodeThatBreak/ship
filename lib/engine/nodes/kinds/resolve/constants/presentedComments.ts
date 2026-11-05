import "server-only";

/** One open comment line's per-comment body cap (2 000 chars). */
export const RESOLVE_BODY_CAP = 2000;

/** The whole comment block keeps whole id-tagged lines under this cap. */
export const RESOLVE_COMMENTS_BLOCK_CAP = 40_000;

/** Appended when the id-tagged line set itself exceeded the block cap. */
export const RESOLVE_COMMENTS_TRUNCATION_NOTE =
  "Note: the open-comment list was truncated — some comments were omitted from this prompt. Decide only on the comments listed above.";
