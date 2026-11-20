import "server-only";

import { z } from "zod";

// ── input / output schemas ───────────────────────────────────────────────────
export const ReviewInput = z.object({
  /** extra review focus from the developer */
  instructions: z.string().nullable().default(null),
  /** verbatim prompt override */
  prompt: z.string().nullable().default(null),
  /** prompt is the user-edited body only — append internal instructions at run time */
  promptIsBody: z.boolean().default(false),
  /** multi-branch: review a specific branch's MR */
  branchName: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
});
export type ReviewInput = z.infer<typeof ReviewInput>;

export const ReviewOutput = z.object({
  comments: z.number(),
  branchName: z.string().optional(),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

/**
 * The review's `consumes` contract (step 04): the per-branch MR fact the run
 * acts on. The MR itself resolves from flow state at run time
 * (`mrTargetResolver`) — the materialized input carries only the optional
 * branch override, so the contract is deliberately thin here; the typed
 * input-contract seam gets its real workout on the declarative kinds'
 * `input_map` targets.
 */
export const ReviewConsumes = z.object({
  branchName: z.string().nullable().optional(),
});

/** One review comment the agent returns (CR-085) — `file` / `line` optional,
 *  `body` non-empty (docs/architecture/review-node.md). */
export const reviewCommentItemSchema = z.object({
  file: z.string().optional(),
  line: z.number().int().optional(),
  body: z.string().min(1),
});
export type ReviewCommentItem = z.infer<typeof reviewCommentItemSchema>;

/** The review's response contract: the comment ARRAY the directive advertises
 *  and the validator checks (one byte-identical pair — step 05). */
export const ReviewCommentsSchema = z.array(reviewCommentItemSchema);

/** JSON Schema generated from `ReviewCommentsSchema` — carried into
 *  `AgentOutputError.directive(schema, "array")` on the review prompt. */
export const REVIEW_COMMENTS_JSON_SCHEMA: unknown = z.toJSONSchema(ReviewCommentsSchema);
