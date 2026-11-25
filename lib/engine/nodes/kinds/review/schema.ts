import "server-only";

import { z } from "zod";
import { REVIEW_VERDICTS } from "./constants/reviewVerdict";

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
  /** how many comments this run posted (0 on a clean review) */
  comments: z.number(),
  /** the run's verdict — `approve` is the clean review. Absent only when the
   *  run failed before a contract-valid response existed (the agent response
   *  contract requires it; a failed run has no verdict to record). */
  verdict: z.enum(REVIEW_VERDICTS).optional(),
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

/**
 * The review's response contract: one object carrying the verdict and the
 * comment list — what the directive advertises and the validator checks (one
 * byte-identical pair — step 05).
 *
 * A clean review is `{ "verdict": "approve", "comments": [] }`: the verdict
 * names the "nothing to flag" answer, so a bare empty array stays unambiguous
 * evidence of a contract miss instead of masquerading as a clean pass. The
 * verdict is therefore required — an agent that returns only comments has not
 * said whether it is clean, and guessing would fabricate the answer.
 */
export const ReviewResponseSchema = z.object({
  verdict: z.enum(REVIEW_VERDICTS),
  comments: z.array(reviewCommentItemSchema),
});
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;

/** JSON Schema generated from `ReviewResponseSchema` — carried into
 *  `AgentOutputError.directive(...)` on the review prompt. */
export const REVIEW_RESPONSE_JSON_SCHEMA: unknown = z.toJSONSchema(ReviewResponseSchema);
