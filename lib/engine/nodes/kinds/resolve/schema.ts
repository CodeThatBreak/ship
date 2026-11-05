import "server-only";

import { z } from "zod";
import { RESOLVE_COMMENT_ACTIONS } from "./constants/commentActions";

// ── input / output schemas ───────────────────────────────────────────────────
export const ResolveInput = z.object({
  /** developer instructions for what to change */
  instructions: z.string().nullable().default(null),
  /** verbatim prompt override */
  prompt: z.string().nullable().default(null),
  /** prompt is the user-edited body only — append internal instructions at run time */
  promptIsBody: z.boolean().default(false),
  /** multi-branch: resolve comments on a specific branch's MR */
  branchName: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
});
export type ResolveInput = z.infer<typeof ResolveInput>;

export const ResolveOutput = z.object({
  resolved: z.number(),
  branchName: z.string().optional(),
  /** true when the agent actually pushed code changes to the MR branch */
  codeChanged: z.boolean().default(false),
});
export type ResolveOutput = z.infer<typeof ResolveOutput>;

// ── the agent response contract (the plan/schema.ts precedent) ───────────────

export const ResolveCommentDecision = z.object({
  /** comment row id from the prompt list, e.g. "gl_123" */
  id: z.string().min(1),
  action: z.enum(RESOLVE_COMMENT_ACTIONS),
  /** posted back to the thread. Required for answered/wontfix; optional for
   *  fixed (a "what changed" note); must be absent for skipped. */
  reply: z.string().min(1).optional(),
  /** close the thread on the host. skipped ⇒ false. */
  resolve: z.boolean(),
  /** one-line internal note for the artifact/run log (never posted) */
  note: z.string().optional(),
});
export type ResolveCommentDecision = z.infer<typeof ResolveCommentDecision>;

export const ResolveAgentResponse = z.object({
  /** human summary — becomes the artifact content and the chat reply */
  summary: z.string().min(1),
  /** self-report; the engine verifies this and never trusts it for the loop edge */
  codeChanged: z.boolean(),
  decisions: z.array(ResolveCommentDecision),
});
export type ResolveAgentResponse = z.infer<typeof ResolveAgentResponse>;

/**
 * JSON Schema generated from the response schema — carried into
 * `AgentOutputError.directive()` on the run and retry prompts. The
 * refinements (reply required, skipped semantics, id coverage) are enforced
 * server-side; the advertised schema is the structural contract only.
 */
export const RESOLVE_RESPONSE_JSON_SCHEMA: unknown = z.toJSONSchema(ResolveAgentResponse);
