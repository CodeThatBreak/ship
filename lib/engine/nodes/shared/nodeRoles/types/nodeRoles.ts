import "server-only";

import type { NodeRow } from "../../../../../db/rows";
import type { PromptAssembly } from "../../../../prompts/promptLibrary/types/promptLibrary";
import type { FlowCtx } from "../../runContext/types/flowContext";

/** The prompt-route querystring parameters a def's preview may consume. */
export interface PromptPreviewParams {
  /** extra developer instructions (review focus, resolve instructions, pipeline guidance) */
  instructions?: string;
  /** branch-scoped sub-plan preview (plan node only — feeds the composer prefill) */
  branch?: string;
}

/**
 * A def-resolved prompt preview: the template key whose metadata the modal
 * shows (plan may point at plan_refine), the configured body knob (null = the
 * template default is used), and the three-part assembly whose `final` is the
 * exact string the next run sends.
 */
export interface NodePromptPreview {
  templateKey: string;
  configBody: string | null;
  assembly: PromptAssembly;
}

export interface ChatTurnOpts {
  /** per-run model override (the chat panel's pick) */
  model?: string;
  /** branch-scoped thread ref (plan node only) */
  thread?: string | null;
  /**
   * The node's status BEFORE the engine's claim: `sendChat` claims the node
   * (running + a fresh attempt token) before dispatching the turn, so the
   * turn cannot read its own pre-claim state off the live row. The plan turn
   * records it (`PlanInput.previousStatus`) and reverts to it on every
   * no-apply path (guard refusal, contract failure, reply-only).
   */
  previousStatus?: string | null;
}

/**
 * A def that can regenerate its output from a chat message (§T4 ChatRefiner).
 *
 * The plan node's safeness model changed with docs/plan-conversation-refine.md
 * §3b — the OLD guarantee was "a plain chat message must never kick off a
 * refinement run"; the NEW model: a plan chat message changes the plan iff the
 * response carries a plan payload (`{ reply, plan? }` — docs/plan-conversation-
 * refine.md), bounded by the explicit apply policy (§3b). Enforcement is in
 * the response schema, not in the message router — a decision kind still never
 * refines from a chat message (its pick is confirmed on the card).
 */
export interface ChatRefiner {
  chat(ctx: FlowCtx, content: string, model?: string): Promise<string>;
  turn(ctx: FlowCtx, content: string, opts?: ChatTurnOpts): Promise<string>;
}

/** A def that answers conversational follow-ups without changing node state. */
export interface Converser {
  converse(ctx: FlowCtx, content: string): Promise<string>;
}

/** A def that publishes a live prompt preview for the prompt modal. */
export interface PromptPreviewer {
  previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): Promise<NodePromptPreview | null>;
}
