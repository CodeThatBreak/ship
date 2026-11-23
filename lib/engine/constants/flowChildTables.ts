import "server-only";

/** Flow-owned tables, in FK-safe delete order (children before `flows`).
 *  Keep in sync with `FLOW_CHILD_TABLES` in scripts/lib/seed-db.mjs. */
export const FLOW_CHILD_TABLES = [
  'plan_steps',
  'events',
  'messages',
  'runs',
  'artifacts',
  'comments',
  'branches',
  'nodes',
  'hooks', // flow-bound inbound webhooks (wait_for nodes)
] as const;
