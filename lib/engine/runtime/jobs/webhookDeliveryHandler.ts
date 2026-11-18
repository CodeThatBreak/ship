import "server-only";

import { ConflictError } from "../../../errors";
import { flowEngine } from "../../flowEngine";
import { gitHostRegistry } from "../../ports/gitHost";
import { webhookDeliveryPayloadSchema } from "./schemas/jobPayloads";
import type { JobRecord, WebhookDispatchResult } from "./types/job";

/**
 * WebhookDeliveryHandler — dispatches a claimed `webhook_delivery` job
 * (Invariant 7): generic-hook deliveries (template start or waiting-node
 * resume) and GitLab webhook events. Used by BOTH the webhook routes
 * (synchronous in-request claim → dispatch → done) and the worker's job
 * sweep (lease-expiry re-claim after a crash) — one dispatch path, so the
 * crash window is closed by the claim, not by duplicated route logic.
 *
 * Exactly-once across the crash window: a re-claimed job re-dispatches, and
 * the resume path's own node claim (via the transition authority) dedups the
 * side effect — a node already resumed by the first dispatch answers
 * {@link ConflictError}, which here means "already delivered", not failure.
 * Template starts are at-least-once (a crash after flow creation re-creates
 * the flow); the dedup key stops the common retry path from ever reaching a
 * second dispatch.
 *
 * Must never: write node status (the engine's claim paths own that), accept
 * an unvalidated payload, or swallow dispatch errors (the JobQueue's retry
 * budget owns them).
 */
export class WebhookDeliveryHandler {
  async handle(job: JobRecord): Promise<WebhookDispatchResult> {
    const parsed = webhookDeliveryPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new Error(`webhook_delivery payload failed validation: ${parsed.error.message}`);
    }
    const payload = parsed.data;
    if (payload.source === "gitlab") {
      const host = gitHostRegistry.maybe("gitlab");
      if (!host) throw new Error("no gitlab host registered");
      const event = host.parseWebhook(payload.body);
      if (event) await flowEngine.handleHostEvent(event);
      return {};
    }
    if (payload.templateId) {
      const flowId = await flowEngine.startFromTemplate(payload.templateId, payload.body);
      return { startedFlowId: flowId };
    }
    if (payload.flowId && payload.nodeKey) {
      try {
        await flowEngine.resumeNodeFromWebhook(payload.flowId, payload.nodeKey, payload.body);
      } catch (e: unknown) {
        // already resumed by the first dispatch of this job (crash re-claim)
        // — the delivery happened, the job completes
        if (e instanceof ConflictError) return { resumedNodeKey: payload.nodeKey };
        throw e;
      }
      return { resumedNodeKey: payload.nodeKey };
    }
    throw new Error("hook is bound to nothing — rebind it to a template or a waiting node");
  }
}
