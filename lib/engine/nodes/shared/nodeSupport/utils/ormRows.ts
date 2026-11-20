import "server-only";

import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { RowDecodeError, rowIdFromRaw } from "../../../../../db/rowDecodeError";
import { ValidationError } from "../../../../../errors";

/**
 * ORM-row helpers for node support: the decode semantics the raw queries used
 * to get from the RowGateway (`lib/db/rows.ts`), now over Prisma rows. JSONB
 * payloads (nodes.config/input/output) stay narrowed through the rows.ts zod
 * schemas; scalar columns are Prisma-typed and need no checks.
 */

/** RowGateway.get semantics over an ORM row: zod-narrow, throwing on undecodable. */
export const parseRow = <S extends z.ZodTypeAny>(schema: S, row: unknown, source: string): z.infer<S> => {
  const result = schema.safeParse(row);
  if (!result.success) throw new RowDecodeError(source, rowIdFromRaw(row), result.error);
  return result.data;
};

/** RowGateway.all semantics: drop (and log) rows that no longer decode. */
export const parseRows = <S extends z.ZodTypeAny>(schema: S, rowList: readonly unknown[], source: string): z.infer<S>[] => {
  const decoded: z.infer<S>[] = [];
  for (const row of rowList) {
    const result = schema.safeParse(row);
    if (!result.success) {
      console.error("[nodeSupport] skipping undecodable row", {
        sql: source,
        rowId: rowIdFromRaw(row),
        issues: result.error.issues,
      });
      continue;
    }
    decoded.push(result.data);
  }
  return decoded;
};

/** A plain object as a Prisma `Json` field value (`InputJsonValue`). */
export const jsonInput = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

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
