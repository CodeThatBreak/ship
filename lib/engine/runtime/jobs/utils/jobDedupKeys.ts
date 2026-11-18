import "server-only";

/**
 * Dedup keys for the `jobs` table's write-ahead idempotency (Invariant 7).
 * A retried delivery or a re-swept schedule fire re-enqueues into the SAME
 * job row (`ON CONFLICT (dedup_key) DO NOTHING`) — the claim, not the insert,
 * decides who dispatches.
 */

/** A generic-hook delivery: one dispatch per `webhook-id` per hook. */
export const hookDeliveryDedupKey = (hookId: string, webhookId: string): string =>
  `hook:${hookId}:${webhookId}`;

/** A GitLab webhook delivery: one dispatch per `X-Gitlab-Event-UUID`. */
export const gitlabDeliveryDedupKey = (eventUuid: string): string => `gitlab:${eventUuid}`;

/** A template schedule fire: one job per (template, due instant). */
export const scheduleFireDedupKey = (templateId: string, fireAtMs: number): string =>
  `template:${templateId}:${fireAtMs}`;
