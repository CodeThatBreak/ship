import { RESPONSE_EXCERPT_LENGTH } from "../constants";

/** The head of a raw response: full text when short, the first slice + ellipsis.
 *  Module-private to the error class — the constructor excerpts `input.response`;
 *  callers never build `response_excerpt` by hand. */
export const responseExcerpt = (text: string): string => {
  const trimmed = (text ?? "").trim();
  if (trimmed.length <= RESPONSE_EXCERPT_LENGTH) return trimmed;
  return `${trimmed.slice(0, RESPONSE_EXCERPT_LENGTH)}…`;
};
