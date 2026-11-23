import "server-only";

/**
 * The effect lifecycles the EffectRegistry dispatches (step 07, Invariant 8 —
 * target-architecture §7). Closed set: a new "what happens after Y finishes"
 * concern must be expressed as one of these lifecycles on a registration, not
 * as a new call-site special case in the stage runner.
 */
export const EFFECT_LIFECYCLE = {
  /** The node reached a success terminal (done / approved) from a run. */
  AFTER_SUCCESS: "afterSuccess",
  /** The node reached `failed` from a run. */
  AFTER_FAILURE: "afterFailure",
  /** An approval-door transition won (e.g. the build approve → MR-create ordering). */
  AFTER_APPROVAL: "afterApproval",
  /** A declared loop join fired (the loop edge's `when` held — the re-gate). */
  LOOP_REENTRY: "loopReentry",
} as const;

export type EffectLifecycle = (typeof EFFECT_LIFECYCLE)[keyof typeof EFFECT_LIFECYCLE];

/**
 * The registration key for wildcard effects. Declarative effects register
 * under this key and decide relevance themselves from the node's config (the
 * handler no-ops when no verb is declared), so no literal declarative def key
 * ever enters the registry. Built-in node-kind effects (the SDLC chain)
 * register under their concrete defKey.
 */
export const EFFECT_KEY_ANY = "*";
