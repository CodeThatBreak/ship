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
  /** A child flow's last stage reached a terminal (fan-out / split roll-ups). */
  ON_CHILD_TERMINAL: "onChildTerminal",
  /** A declared loop join fired (the loop edge's `when` held — the re-gate). */
  LOOP_REENTRY: "loopReentry",
} as const;

export type EffectLifecycle = (typeof EFFECT_LIFECYCLE)[keyof typeof EFFECT_LIFECYCLE];

/**
 * The registration key for runtime-owned effects. The fan-out and split
 * runtimes own whole child FLOWS — any node kind a step/unit template runs —
 * so their `onChildTerminal` effects register under this key and decide
 * relevance themselves (the linkage lookup inside the effect no-ops when the
 * flow carries none). Node-kind effects (the SDLC chain) always register
 * under their concrete defKey.
 */
export const EFFECT_KEY_ANY = "*";
