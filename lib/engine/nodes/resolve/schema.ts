import { z } from "zod";

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
});
export type ResolveOutput = z.infer<typeof ResolveOutput>;
