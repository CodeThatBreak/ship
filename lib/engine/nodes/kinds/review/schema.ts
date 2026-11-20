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
