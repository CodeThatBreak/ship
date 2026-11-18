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
