import "server-only";

import type { CommentRow } from "../../../../../db/rows";

/**
 * Whether a comment row participates in the resolve loop: parsed from the
 * row's raw host JSON (the `commentService.listForFlow` pattern) — the host
 * never stores it as a dedicated column. Unparseable/absent raw defaults to
 * `true` (a resolvable review thread). Shared by the resolve contract and
 * `resolveEffects`, which must never host-call a non-resolvable thread (G8).
 */
export const commentResolvable = (row: CommentRow): boolean => {
  let parsed: Partial<{ resolvable: unknown }> = {};
  try {
    parsed = row.raw ? (JSON.parse(row.raw) as Partial<{ resolvable: unknown }>) : {};
  } catch {
    parsed = {};
  }
  return typeof parsed.resolvable === "boolean" ? parsed.resolvable : true;
};
