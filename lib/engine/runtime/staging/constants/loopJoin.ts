import "server-only";

/**
 * The declared loop-join descriptor's reset set (step 07 task 5): what a loop
 * edge's re-entry may reset. The descriptor itself is `{ when, resets }` —
 * `when` is the loop edge's own condition (the engine never picks an
 * unconditional rerun — §4.3 — and the condition's output-key references are
 * lint-checked against the producing node's outputSchema, step 04); `resets`
 * is this set, interpreted by the LoopJoin.
 */
export const LOOP_JOIN_RESETS = {
  /** success terminals (done / approved) re-run on re-entry */
  SUCCESS_TERMINALS: true,
  /** previously skipped branches re-open (CR-007) */
  SKIPPED_BRANCHES: true,
} as const;

/** The default descriptor every loop edge joins under (until a template
 *  declares its own — the shape is here, the seeded template uses it as-is). */
export const DEFAULT_LOOP_JOIN_DESCRIPTOR = {
  when: null,
  resets: LOOP_JOIN_RESETS,
} as const;
