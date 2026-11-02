import type { Draft } from "../draft";

/** How many structural snapshots undo/redo keeps. */
export const UNDO_STACK_LIMIT = 50;
/** Bursts of structural edits coalesce into one snapshot. */
export const SNAPSHOT_COALESCE_MS = 500;

export type DraftHistoryStacks = {
  undo: Draft[];
  redo: Draft[];
  lastSnapAt: number;
};

/**
 * Updates undo/redo stacks for a local draft mutation (not undo/redo jumps).
 * Redo is always cleared; undo snapshots coalesce within {@link SNAPSHOT_COALESCE_MS}.
 */
export const planDraftHistoryAfterMutation = (
  cur: Draft,
  next: Draft,
  stacks: DraftHistoryStacks,
  now: number,
): DraftHistoryStacks => {
  const structural = next.nodes !== cur.nodes || next.edges !== cur.edges;
  const redo: Draft[] = [];
  let undo = stacks.undo;
  let lastSnapAt = stacks.lastSnapAt;
  if (
    structural &&
    (undo.length === 0 || now - lastSnapAt > SNAPSHOT_COALESCE_MS)
  ) {
    undo = [...undo, cur];
    if (undo.length > UNDO_STACK_LIMIT) undo = undo.slice(1);
    lastSnapAt = now;
  }
  return { undo, redo, lastSnapAt };
};
