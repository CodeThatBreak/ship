import "server-only";

/** Flow-owned tables, in FK-safe delete order (children before `flows`).
 *  Keep in sync with `FLOW_CHILD_TABLES` in scripts/lib/seed-db.mjs. */
export const FLOW_CHILD_TABLES = [
  'step_merges', // parent_flow_id + flow_id — fan-out merge-back records
  'plan_steps', // sub_flow_id → flows (fan-out checklist)
  'events',
  'messages',
  'runs',
  'artifacts',
  'comments',
  'branches',
  'nodes',
  'hooks', // flow-bound inbound webhooks (wait_for nodes)
] as const;
