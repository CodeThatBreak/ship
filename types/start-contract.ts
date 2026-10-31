import { z } from "zod";

/**
 * The Start node's contract (§5): the declared fields a flow starts with.
 * One field list defines both sides — whatever the trigger provides is
 * validated against it and published as the start node's output, so every
 * downstream node maps from those variables.
 *
 * Client-safe module (pure zod + helpers). The engine runtime, contracts API,
 * static linter and graph API import the same rules via `lib/engine/…/contract`
 * or directly from here in UI code.
 *
 * Who provides the values follows the start node's trigger type:
 *   auto     → the field's authored default (the template editor's values)
 *   manual   → the user fills the form when triggering the node
 *   approval → same — values are provided when the user starts the flow
 *   webhook  → the delivery payload must match the contract (strictly:
 *              unknown fields are rejected, missing required fields fail)
 */

export const START_FIELD_TYPES = ["string", "number", "boolean", "object", "array"] as const;
export type StartFieldType = (typeof START_FIELD_TYPES)[number];

export interface StartContractField {
  key: string;
  label?: string;
  type: StartFieldType;
  required: boolean;
  /** value used when the trigger provides nothing (auto / schedule fires) */
  default?: unknown;
}

export const StartContractFieldSchema = z.object({
  key: z
    .string()
    .min(1, "a field needs a name")
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "field names use letters, digits and underscores"),
  label: z.string().optional(),
  type: z.enum(START_FIELD_TYPES).default("string"),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
});

/** The contract lives on the start node instance's config under `contract`. */
export const StartContractConfigSchema = z.object({
  contract: z.array(StartContractFieldSchema).default([]),
});

/** Parse the contract off a start node config — missing/invalid → none declared. */
export function parseStartContract(config: unknown): StartContractField[] {
  if (!config || typeof config !== "object") return [];
  const parsed = StartContractConfigSchema.safeParse(config);
  return parsed.success ? (parsed.data.contract as StartContractField[]) : [];
}

/** Loud checks for the linter (template save/import): readable, one per problem. */
export function lintStartContract(config: unknown, where: string): string[] {
  if (!config || typeof config !== "object" || !("contract" in (config as Record<string, unknown>))) return [];
  const parsed = StartContractConfigSchema.safeParse(config);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return [`${where}: invalid start contract${issue?.path?.length ? ` (${issue.path.join(".")})` : ""} — ${issue?.message ?? "invalid"}`];
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of parsed.data.contract) {
    if (seen.has(f.key)) problems.push(`${where}: duplicate start contract field "${f.key}"`);
    seen.add(f.key);
  }
  return problems;
}

/** The JSON-Schema-shaped contract (same object serves as input and output). */
export function startContractJsonSchema(fields: StartContractField[]): unknown {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    properties[f.key] = {
      type: f.type,
      ...(f.label ? { description: f.label } : {}),
    };
    if (f.required) required.push(f.key);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

/**
 * Validate a provided payload against the contract. Light coercion applies to
 * string values (the trigger form sends text): numeric strings become numbers,
 * "true"/"false" booleans, and JSON text becomes objects/arrays — a webhook
 * sending proper JSON is untouched by this. Strict on shape: unknown fields
 * are rejected, so the payload really is of that contract.
 */
export function validateAgainstContract(
  fields: StartContractField[],
  values: unknown,
): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const provided: Record<string, unknown> =
    values && typeof values === "object" && !Array.isArray(values)
      ? { ...(values as Record<string, unknown>) }
      : {};
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    let v = provided[f.key];
    delete provided[f.key];
    if (v === undefined || v === null || v === "") v = f.default;
    if (v === undefined || v === null || v === "") {
      if (f.required) return { ok: false, error: `missing required value "${f.key}"` };
      continue; // empty optionals are omitted from the published output
    }
    v = coerce(v, f.type);
    if (!typeMatches(v, f.type)) {
      return { ok: false, error: `"${f.key}" must be a ${f.type} (got ${typeof v === "object" ? (Array.isArray(v) ? "array" : "object") : typeof v})` };
    }
    out[f.key] = v;
  }
  const extra = Object.keys(provided);
  if (extra.length) {
    return { ok: false, error: `payload carries fields outside the contract: ${extra.join(", ")}` };
  }
  return { ok: true, values: out };
}

function coerce(v: unknown, type: StartFieldType): unknown {
  if (typeof v !== "string") return v;
  if (type === "number") {
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }
  if (type === "boolean") {
    if (v === "true") return true;
    if (v === "false") return false;
    return v;
  }
  if (type === "object" || type === "array") {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

function typeMatches(v: unknown, type: StartFieldType): boolean {
  switch (type) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "boolean": return typeof v === "boolean";
    case "object": return typeof v === "object" && v !== null && !Array.isArray(v);
    case "array": return Array.isArray(v);
  }
}
