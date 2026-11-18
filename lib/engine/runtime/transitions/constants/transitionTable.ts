import "server-only";

import { NODE_STATUS } from "../../../constants/nodeStatus";
import type { TransitionRow } from "../types/transitions";

/**
 * The declared node transition table (target-architecture §2) — the ENTIRE
 * legal transition set. `TransitionAuthority` is its only executor: every
 * `nodes.status` / `attempt_id` write resolves a row here first, so an
 * undeclared from→to pair fails loudly instead of landing in the DB.
 *
 * Rules the rows encode:
 * - `attempt_id` is written only by claim-shaped rows (to-set `running`),
 *   cleared by every write that leaves `running`.
 * - Terminal writes carry the validated `output` in the same statement.
 * - Rows whose from-set is a broad complement (e.g. `skipUnit`,
 *   `mergeBackFailed`) deliberately exclude terminals the engine must never
 *   overwrite — that exclusion IS the fix for the late-aggregate overwrite
 *   bugs (see `tests/engine-overhaul/finishSplitOverwrite.test.ts`).
 */
export const TRANSITION_TABLE = {
  // ── claims: → running, each stamps a fresh attempt_id ────────────────────
  /** Engine auto/approval-triggered stage start on a pending node. */
  runFromPending: { from: [NODE_STATUS.PENDING], to: [NODE_STATUS.RUNNING], actor: "trigger" },
  /** User retry of a failed node (recorded input re-run). */
  retry: { from: [NODE_STATUS.FAILED], to: [NODE_STATUS.RUNNING], actor: "user" },
  /** Chat refine claim: any non-running conversable state may be claimed. */
  chatRefine: {
    from: [NODE_STATUS.PENDING, NODE_STATUS.AWAITING_APPROVAL, NODE_STATUS.FAILED, NODE_STATUS.DONE, NODE_STATUS.WAITING],
    to: [NODE_STATUS.RUNNING],
    actor: "user",
  },
  /** A wait armed on `wait_for` fired (webhook delivery / timer elapsed). */
  resumeWait: { from: [NODE_STATUS.WAITING], to: [NODE_STATUS.RUNNING], actor: "trigger" },
  /** Effect-driven rerun of an approved node (the build commit-fix agent). */
  commitFix: { from: [NODE_STATUS.APPROVED], to: [NODE_STATUS.RUNNING], actor: "effect" },
  /** Manual panel re-run of a post-MR chain stage (pipeline gate / review). */
  manualStage: {
    from: [NODE_STATUS.PENDING, NODE_STATUS.FAILED, NODE_STATUS.DONE],
    to: [NODE_STATUS.RUNNING],
    actor: "user",
  },
  /** Manual resolve run (Run button / API). */
  manualResolve: {
    from: [NODE_STATUS.PENDING, NODE_STATUS.FAILED, NODE_STATUS.DONE, NODE_STATUS.WAITING],
    to: [NODE_STATUS.RUNNING],
    actor: "user",
  },

  // ── waits and branch resolution ──────────────────────────────────────────
  /** A node holds at `waiting` until its event source delivers (§6). */
  armWait: { from: [NODE_STATUS.PENDING], to: [NODE_STATUS.WAITING], actor: "effect" },
  /** Branch not taken: an inactive edge's target with all edges resolved. */
  skipBranch: { from: [NODE_STATUS.PENDING], to: [NODE_STATUS.SKIPPED], actor: "effect" },
  /** Split unit skipped by the user: every non-terminal child node of the unit's flow. */
  skipUnit: {
    from: [NODE_STATUS.PENDING, NODE_STATUS.RUNNING, NODE_STATUS.WAITING, NODE_STATUS.AWAITING_APPROVAL, NODE_STATUS.APPROVED, NODE_STATUS.FAILED],
    to: [NODE_STATUS.SKIPPED],
    actor: "user",
  },

  // ── approvals ────────────────────────────────────────────────────────────
  /** Generic approval of an awaiting node (plan, declarative, split units). */
  approve: { from: [NODE_STATUS.AWAITING_APPROVAL], to: [NODE_STATUS.APPROVED], actor: "user" },
  /** A decision's manual branch pick (choose action). */
  chooseBranch: { from: [NODE_STATUS.AWAITING_APPROVAL], to: [NODE_STATUS.APPROVED], actor: "user" },
  /** The SDLC build approval ("Approve & create MR"). */
  buildApprove: { from: [NODE_STATUS.AWAITING_APPROVAL], to: [NODE_STATUS.APPROVED], actor: "user" },
  /** MR creation failed: hand the approved step back to the developer. */
  mrHandback: { from: [NODE_STATUS.APPROVED], to: [NODE_STATUS.AWAITING_APPROVAL], actor: "system" },
  /** A commit-fix attempt finished: the bounded loop re-claims from approved.
   * A genuinely failed fix run (or any terminal outside the from-set) is left
   * untouched — the old unconditional `finally` overwrite is gone. */
  commitFixHandback: {
    from: [NODE_STATUS.RUNNING, NODE_STATUS.AWAITING_APPROVAL],
    to: [NODE_STATUS.APPROVED],
    actor: "effect",
  },

  // ── run outcomes (the defs' terminal door) ───────────────────────────────
  /** A finished run publishes its outcome: status + validated output in one
   * fenced statement (the step-04 contract seam validates `output`). */
  outcome: {
    from: [NODE_STATUS.RUNNING],
    to: [NODE_STATUS.AWAITING_APPROVAL, NODE_STATUS.DONE, NODE_STATUS.FAILED],
    actor: "effect",
  },
  /** Fan-out aggregate terminal (trigger-type dependent: approval holds).
   *  From-set includes the aggregate's own held/failed states — the rollup
   *  republishes as units approve/retry; a published `done` aggregate is
   *  FINAL until a loop re-entry re-claims the node (CR-009). A user's
   *  fresh claim is protected by the attempt fence. */
  fanoutOutcome: {
    from: [NODE_STATUS.RUNNING, NODE_STATUS.AWAITING_APPROVAL, NODE_STATUS.FAILED],
    to: [NODE_STATUS.AWAITING_APPROVAL, NODE_STATUS.DONE],
    actor: "effect",
  },
  /** Split aggregate terminal (worst-of its unit entries, decision 4) —
   *  republishes from its own held/failed states as units approve or retry;
   *  a published `done` aggregate is final until re-entry re-claims. */
  splitOutcome: {
    from: [NODE_STATUS.RUNNING, NODE_STATUS.AWAITING_APPROVAL, NODE_STATUS.FAILED],
    to: [NODE_STATUS.FAILED, NODE_STATUS.AWAITING_APPROVAL, NODE_STATUS.DONE],
    actor: "effect",
  },

  // ── failures ─────────────────────────────────────────────────────────────
  /** A stage's fire-and-forget run errored (bg catch / stage catch). */
  stageError: { from: [NODE_STATUS.RUNNING], to: [NODE_STATUS.FAILED], actor: "system" },
  /** User cancel of an in-flight node. */
  cancel: {
    from: [NODE_STATUS.RUNNING, NODE_STATUS.WAITING, NODE_STATUS.AWAITING_APPROVAL],
    to: [NODE_STATUS.FAILED],
    actor: "user",
  },
  /** Reconciler: an orphaned run with nothing recoverable. */
  orphanFail: { from: [NODE_STATUS.RUNNING], to: [NODE_STATUS.FAILED], actor: "reconcile" },
  /** Reconciler: recovery declined — fail so the user can retry. */
  recoverDeclined: { from: [NODE_STATUS.RUNNING], to: [NODE_STATUS.FAILED], actor: "reconcile" },
  /** Fan-out merge-back failed on the step child's work node. */
  mergeBackFailed: {
    from: [NODE_STATUS.PENDING, NODE_STATUS.RUNNING, NODE_STATUS.WAITING, NODE_STATUS.AWAITING_APPROVAL, NODE_STATUS.APPROVED],
    to: [NODE_STATUS.FAILED],
    actor: "effect",
  },

  // ── merge-back loop (plan fan-out) ───────────────────────────────────────
  /** A merge-fix agent finished: keep the child awaiting the re-attempted merge. */
  mergeFixAwaiting: {
    from: [NODE_STATUS.RUNNING, NODE_STATUS.AWAITING_APPROVAL],
    to: [NODE_STATUS.AWAITING_APPROVAL],
    actor: "effect",
  },
  /** User Retry on a merge-failed step: re-enter the merge loop. */
  mergeRetryAwaiting: { from: [NODE_STATUS.FAILED], to: [NODE_STATUS.AWAITING_APPROVAL], actor: "user" },

  // ── resets ───────────────────────────────────────────────────────────────
  /** Loop re-entry: a success terminal or prior skip resets to pending. */
  loopReentry: {
    from: [NODE_STATUS.DONE, NODE_STATUS.APPROVED, NODE_STATUS.SKIPPED],
    to: [NODE_STATUS.PENDING],
    actor: "effect",
  },
  /** Gate/review reset to pending once branch MRs exist (never mid-run). */
  gateReset: {
    from: [NODE_STATUS.WAITING, NODE_STATUS.AWAITING_APPROVAL, NODE_STATUS.APPROVED, NODE_STATUS.FAILED, NODE_STATUS.SKIPPED, NODE_STATUS.DONE],
    to: [NODE_STATUS.PENDING],
    actor: "effect",
  },

  // ── reverts (failed run handed back to its pre-claim shape) ──────────────
  /** Plan retry with no recorded turn: revert to the chat-ready status. */
  planRetryRevert: { from: [NODE_STATUS.FAILED], to: [NODE_STATUS.PENDING, NODE_STATUS.AWAITING_APPROVAL], actor: "user" },
  /** A chat turn that landed no outcome: revert to the pre-claim status
   *  (any conversable state the claim may have taken — including approved,
   *  the mid-build plan's chat-guard refusal path). */
  chatRevert: {
    from: [NODE_STATUS.RUNNING],
    to: [NODE_STATUS.PENDING, NODE_STATUS.AWAITING_APPROVAL, NODE_STATUS.APPROVED, NODE_STATUS.FAILED, NODE_STATUS.DONE, NODE_STATUS.WAITING],
    actor: "user",
  },
} as const satisfies Record<string, TransitionRow>;
