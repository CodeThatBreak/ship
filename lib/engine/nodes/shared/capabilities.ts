import { z } from "zod";

/**
 * The result of a fan-out merge-back attempt (step sub-flows; Phase 1 landed
 * the one-shot arena op, Phase 2 the classification the bounded merge-fix
 * agent drives):
 *
 * - `merged` — the step branch landed (pushed + step branch deleted). `stale`
 *   is set when the step branch had diverged from the integration head (stale
 *   base): the merge is the repair then (never a rebase) and the parent panel
 *   shows the stale-base chip.
 * - `conflict` — `merge --no-ff` conflicts; repairable CODE state → the
 *   bounded merge-fix agent on the step branch, then a re-attempt.
 * - `rejected` — the integration-branch push was declined by a
 *   pre-receive/pre-push hook (code state) → the same bounded fix agent, the
 *   commit-fix classification reused verbatim.
 * - `failed` — infra (network/auth) or the merge-fix budget exhausted →
 *   failed-visible on the parent (user Retry re-runs).
 */
export type MergeBackResult =
  | { status: "merged"; stale?: boolean }
  | { status: "conflict"; error: string }
  | { status: "rejected"; error: string }
  | { status: "failed"; error: string };

/**
 * A code child's merge-back hook — the one engine op the step_build def owns.
 * Runs in the parent flow's merge arena (per-flow workspace clone / worktree)
 * when the child step is approved: merge the step branch into the parent's
 * integration branch, push, delete the step branch. Implementations serialize
 * per integration branch (in-memory lock) and persist a durable step_merges
 * row.
 */
export interface MergeBackArgs {
  /** the parent fan-out flow */
  parentFlowId: string;
  /** the fan-out node's instance key on the parent (e.g. "build") */
  parentNodeKey: string;
  /** the child flow that was approved */
  childFlowId: string;
  /** the child's own step branch */
  branch: string;
  /** the parent-side integration branch the step branch merges into */
  integrationBranch: string;
  /** commit message prefix/annotation, e.g. "[s2] Add auth middleware" */
  message: string;
  /** repo default branch (merge target fallback when the integration branch was never pushed) */
  baseBranch: string;
  /**
   * Phase 2 (merge-fix / reconcile resume): the durable `step_merges` row a
   * re-attempt should UPDATE (attempts increment on the same row) instead of
   * inserting a fresh one — one row per step merge attempt series, so
   * reconcile after a restart resumes exactly the row it found.
   */
  mergeRowId?: string;
}

/**
 * The serializable UI capabilities — the subset that crosses the
 * server→client boundary (the flow snapshot / RSC payload / API JSON). The
 * engine-only members (a callback and a Zod contract) stay out: RSC
 * serialization rejects class instances and functions, so the snapshot
 * carries exactly this shape per node.
 */
export interface NodeUiCapabilities {
  /**
   * A chat message can regenerate this node's output (the chat panel's
   * refine toggle) — true only when the node's chat handler runs a full
   * refinement.
   */
  refinable?: boolean;
  /**
   * The node's custom conversation mode (docs/plan-conversation-refine.md §4):
   * "plan" = the chat composer IS the node's one input — prefirst-run it
   * carries the prefilled plan body, afterwards it is a conversation whose
   * response contract `{ reply, plan? }` decides whether a message updates
   * the plan. No UI toggle involved; the plan def is the first consumer.
   */
  chatMode?: "plan";
  /**
   * The prompt-route node key the chat's prompt preview / editor targets
   * (set for nodes that publish a user-editable prompt before their first run).
   */
  promptNode?: string;
  /** The panel header title; falls back to the node's label. */
  panelTitle?: string;
}

export interface NodeCapabilities extends NodeUiCapabilities {
  /**
   * Code children only: invoked by the StepFlowManager on child approval —
   * branch lifecycle for fan-out children. Today only `step_build`
   * implements it; every other kind's children aggregate outputs instead.
   */
  mergeBack?: (args: MergeBackArgs) => Promise<MergeBackResult>;
  /**
   * The output contract this def publishes when its node fans out (the
   * aggregate shape downstream templates map against — lint rule 4 checks
   * `{{nodes.X.output.steps.*}}` statically against it). A generic default
   * exists; per-def values may narrow it ("steps", or "from-plan", where the
   * aggregate applies unconditionally).
   */
  fanoutOutput?: z.ZodTypeAny;
  /**
   * The aggregate output contract this def publishes when its node consumes a
   * split `per-unit` (agent-node split plan §3, decision 4) — the
   * `{units: [{key, title, status, output}]}` shape the join validates
   * against. The split runtime's default covers the generic shape.
   */
  splitOutput?: z.ZodTypeAny;
}

/**
 * Project a def's capabilities onto the serializable UI subset for the flow
 * snapshot — a plain object the RSC boundary / `JSON.stringify` can carry.
 * Pure helper (no state), so it stays a function (§3.1).
 */
export function uiCapabilities(
  cap: NodeCapabilities | null | undefined,
): NodeUiCapabilities | null {
  if (!cap) return null;
  return {
    refinable: cap.refinable,
    chatMode: cap.chatMode,
    promptNode: cap.promptNode,
    panelTitle: cap.panelTitle,
  };
}

/** The default fan-out aggregate contract every fan-out-capable def publishes. */
export const DEFAULT_FANOUT_OUTPUT = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      branch: z.string().optional(),
      artifact_id: z.string().optional(),
      output: z.unknown().optional(),
    })
  ),
});
