import "server-only";

import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { FlowTemplateNodeRow, type TemplateNodeTrigger } from "../../../../db/rows";
import type { TemplateEdgeSpec, TemplateNodeSpec } from "../../../types/template";

/**
 * ORM-row helpers for the template store: the decode/payload semantics the
 * raw queries used to get from the RowGateway (`lib/db/rows.ts`), now over
 * Prisma rows. JSONB payloads stay narrowed through the rows.ts zod schemas;
 * scalar columns are Prisma-typed and need no checks. The shared row-decode
 * helpers (`parseRow`/`parseRows`/`jsonInput`) live in
 * `lib/db/ormRowHelpers.ts` — only the template-store-specific payload and
 * spec mappers stay here.
 */

/** Parse a string-or-object JSON cell; malformed JSON falls back. */
export const parseJson = <T>(raw: unknown, fallback: T): T => {
  if (typeof raw !== "string") return raw as T ?? fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/**
 * A JSONB payload narrowed through its rows.ts zod schema. Corrupt payloads
 * fall back to `{}` — the graph read stayed feed-tolerant through the ORM
 * move (a bad cell must not blank a template's canvas).
 */
export const jsonPayload = <S extends z.ZodType<Record<string, unknown> | null>>(
  schema: S,
  raw: unknown,
): Record<string, unknown> => {
  const value = parseJson<unknown>(raw, null);
  if (value == null) return {};
  const parsed = schema.safeParse(value);
  return parsed.success && parsed.data ? parsed.data : {};
};

/** A node trigger payload ({type, minutes?, wait_for?}) as the TS vocabulary shape. */
export const parseNodeTrigger = (o: Record<string, unknown>): TemplateNodeTrigger => {
  return {
    type: typeof o.type === "string" ? o.type : "auto",
    minutes: typeof o.minutes === "number" ? o.minutes : undefined,
    // the stored payload keeps the snake_case `wait_for` key (client + seeder
    // format); the TS vocabulary field is camelCase
    waitFor: typeof o.wait_for === "string" ? o.wait_for : undefined,
  };
};

/** A flow_template_nodes row (+ its node_template) as a runtime node spec. */
export const templateNodeSpecFromRow = (
  row: Prisma.FlowTemplateNodeGetPayload<{ include: { nodeTemplate: true } }>,
): TemplateNodeSpec => {
  // Built-ins resolve their NodeDefinition by registry key; declarative
  // kinds (agent, …) resolve by the node_templates row id so the registry
  // can hydrate a runtime instance per catalog entry.
  const defKey = row.nodeTemplate.isBuiltin ? row.nodeTemplate.key : row.nodeTemplate.id;
  return {
    key: row.nodeKey,
    defKey,
    nodeTemplateId: row.nodeTemplateId,
    catalogKind: row.nodeTemplate.kind,
    label: row.label ?? row.nodeTemplate.name,
    joinMode: row.joinMode === "any" ? "any" : "all",
    config: jsonPayload(FlowTemplateNodeRow.shape.config, row.config),
    trigger: parseNodeTrigger(jsonPayload(FlowTemplateNodeRow.shape.trigger, row.trigger)),
    inputMap: jsonPayload(FlowTemplateNodeRow.shape.inputMap, row.inputMap),
    x: row.x,
    y: row.y,
  };
};

/** A flow_template_edges row as a runtime edge spec. */
export const templateEdgeSpecFromRow = (row: {
  fromKey: string;
  toKey: string;
  kind: string;
  label: string | null;
  condition: string | null;
}): TemplateEdgeSpec => ({
  from: row.fromKey,
  to: row.toKey,
  kind: row.kind === "loop" ? "loop" : "next",
  label: row.label ?? null,
  condition: row.condition ?? null,
});
