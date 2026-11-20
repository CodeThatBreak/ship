import "server-only";

import { z } from "zod";

/**
 * JSONB payload schemas per job kind (step 03). Enqueue validates; the
 * dispatcher re-parses before acting — a malformed payload fails the job
 * loudly instead of smuggling an unknown shape into the engine.
 */

/** A generic-hook delivery snapshot: the hook binding at enqueue time. */
export const hookDeliveryPayloadSchema = z.object({
  source: z.literal("hook"),
  hookId: z.string().min(1),
  /** snapshot of the hook binding (template start vs node resume) */
  templateId: z.string().nullable(),
  flowId: z.string().nullable(),
  nodeKey: z.string().nullable(),
  /** the delivery body AFTER the hook's JSONata filter decided to keep it */
  body: z.unknown(),
});

/** A GitLab webhook delivery: the raw event body (the host adapter re-parses). */
export const gitlabDeliveryPayloadSchema = z.object({
  source: z.literal("gitlab"),
  body: z.unknown(),
});

export const webhookDeliveryPayloadSchema = z.discriminatedUnion("source", [
  hookDeliveryPayloadSchema,
  gitlabDeliveryPayloadSchema,
]);

export type WebhookDeliveryPayload = z.infer<typeof webhookDeliveryPayloadSchema>;

/** A template schedule fire: the due instant + interval for the advance. */
export const scheduleFirePayloadSchema = z.object({
  templateId: z.string().min(1),
  /** epoch ms of the fire this job represents (dedup key component) */
  fireAt: z.number().int().positive(),
  /** minutes between fires — the completion advance uses it */
  intervalMin: z.number().positive(),
});

export type ScheduleFirePayload = z.infer<typeof scheduleFirePayloadSchema>;

/** A cancel intent: the node the cancel finalizes (step 06 task 4). */
export const cancelPayloadSchema = z.object({
  flowId: z.string().min(1),
  nodeKey: z.string().min(1),
});

export type CancelPayload = z.infer<typeof cancelPayloadSchema>;

/**
 * An MR creation: one job per branch target (step 06 task 5). `branchName`
 * absent = the flow-level MR; `emitNodeKey` is the build node (the commit-fix
 * stage the fix attempts claim, and the node a budget-exhausted handback
 * reverts). `gateKey`/`reviewKey` ride along so the re-claim path resets the
 * same nodes the inline path would.
 */
export const mrCreatePayloadSchema = z.object({
  flowId: z.string().min(1),
  branchName: z.string().min(1).optional(),
  emitNodeKey: z.string().min(1).optional(),
  gateKey: z.string().min(1).nullable().optional(),
  reviewKey: z.string().min(1).nullable().optional(),
  /** multi-branch: the chain resets gate+review once after ALL targets —
   *  single-branch: `create` resets them itself */
  skipGateReviewReset: z.boolean().optional(),
  maxCommitFixAttempts: z.number().int().positive().optional(),
});

export type MrCreatePayload = z.infer<typeof mrCreatePayloadSchema>;
