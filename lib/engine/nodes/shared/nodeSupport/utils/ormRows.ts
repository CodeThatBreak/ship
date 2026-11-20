import "server-only";

import { ValidationError } from "../../../../../errors";

/**
 * Feature-local helpers for node support. The shared row-decode helpers
 * (`parseRow`/`parseRows`/`jsonInput`) live in `lib/db/ormRowHelpers.ts`;
 * what stays here is the nodes-table-specific patch normalization.
 */

/**
 * The nodes table's JSONB columns whose patch values may arrive pre-serialized
 * (`JSON.stringify`ed) from callers.
 */
const NODE_JSONB_COLUMNS = ["input", "output", "config"] as const;

/**
 * The raw-era `setNode` contract keyed patches by DB column name; Prisma
 * fields are camelCase. Map the snake_case columns a caller may pass (the
 * refused `status`/`attempt_id` are rejected before this runs).
 */
const NODE_COLUMN_TO_FIELD: Record<string, string> = {
  node_key: "nodeKey",
  flow_id: "flowId",
  agent_id: "agentId",
  agent_ref: "agentRef",
  session_id: "sessionId",
  join_mode: "joinMode",
  wait_until: "waitUntil",
  lease_until: "leaseUntil",
};

/**
 * text→jsonb cast parity for `setNode`: the raw path relied on Postgres's
 * `text → jsonb` cast to parse pre-serialized strings (`nodeDefinition`,
 * `planNode`, `decisionNode` and `flowEngine` pass `JSON.stringify(...)`),
 * so the column stored a proper JSON object. Prisma's `Json` field would
 * store the same string as a JSON string scalar (double-encoded), which the
 * row mappers then reject on read. Parse the string back to an object; on
 * invalid JSON text, fail loudly — the old path surfaced a Postgres cast
 * error, and silently storing the text would bury the bug (AGENTS §2.9).
 * Scoped to these columns only: other patch keys are regular scalars/columns.
 * Also maps raw-era snake_case column keys onto their Prisma field names.
 */
export const parseNodeJsonPatch = (patch: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    normalized[NODE_COLUMN_TO_FIELD[key] ?? key] = value;
  }
  for (const column of NODE_JSONB_COLUMNS) {
    const value = normalized[column];
    if (typeof value !== "string") continue;
    try {
      normalized[column] = JSON.parse(value);
    } catch {
      throw new ValidationError(
        `setNode ${column}: invalid JSON text for a jsonb column (callers must pass an object or valid JSON text)`,
      );
    }
  }
  return normalized;
};
