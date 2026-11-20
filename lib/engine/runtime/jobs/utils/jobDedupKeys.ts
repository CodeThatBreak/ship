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

/**
 * A cancel intent: one live finalize per node. The handler FREES the key on
 * completion (the same node can be cancelled again after a retry) — a crash
 * before the free is healed by the sweep's re-claim (no-op + free).
 */
export const cancelDedupKey = (flowId: string, nodeKey: string): string =>
  `cancel:${flowId}:${nodeKey}`;

/**
 * An MR creation: one job per BRANCH target (`_` = the flow-level MR) — a
 * flow-level key would collapse a multi-branch approve into one create, so
 * the key carries the branch. Freed on completion (a re-approve after a
 * failed creation must be able to enqueue a fresh intent; the adopt path
 * dedups the side effect, not the key).
 */
export const mrCreateDedupKey = (flowId: string, branch?: string): string =>
  `mr_create:${flowId}:${branch ?? "_"}`;
