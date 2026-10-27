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
