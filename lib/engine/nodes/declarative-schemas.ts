import { z } from "zod";
import { mcpSourcesSchema } from "../templates/node-config";
import { splitConsumeSchema, splitParallelMaxSchema } from "./shared/split";
import {
  AGENT_MODE,
  AGENT_MODES,
  AGENT_OUTPUT_FORMAT,
  AGENT_OUTPUT_FORMATS,
  DECISION_SOURCES,
  HTTP_METHODS,
  SCRIPT_RUNTIMES,
} from "../constants/declarative";

/** Closed value sets live in `constants/declarative.ts`; re-exported here so
 *  this module's public surface is unchanged. */
export {
  AGENT_MODE,
  AGENT_MODES,
  AGENT_OUTPUT_FORMAT,
  AGENT_OUTPUT_FORMATS,
  DECISION_SOURCES,
  HTTP_METHODS,
  SCRIPT_RUNTIMES,
} from "../constants/declarative";
export type { AgentMode, AgentOutputFormat } from "../constants/declarative";

/**
 * The declarative node definitions stored on `node_templates.config` (§4.3–4.5).
 * One schema per kind — imported by the runtime classes (which hydrate rows)
 * AND by TemplateStore.createNodeTemplate/ensureNodeTemplate, which validates
 * configs at creation time. Kept in its own module so the store never has to
 * import the runtime classes (which import the store).
 */

export const AgentDefSchema = z.looseObject({
  prompt: z.string().default(""),
  /** plan = read-only judgment run; agent = repo workspace run */
  mode: z.enum(AGENT_MODES).default(AGENT_MODE.PLAN),
  /** null = the flow/default model (settings.default_model) */
  model: z.string().nullable().default(null),
  /**
   * Ambient setting layers the local runtime loads MCP servers from
   * (Cursor `local.settingSources`) — [] = SDK default, inline servers only.
   * The node threads it into every run it starts.
   */
  mcp_sources: mcpSourcesSchema,
  /** markdown → {markdown} output + markdown artifact; json → validated payload */
  output: z.enum(AGENT_OUTPUT_FORMATS).default(AGENT_OUTPUT_FORMAT.MARKDOWN),
  /** when output=json: JSON Schema the response must satisfy. The raw
   *  TypeScript members it was authored from ride along as `output_schema_ts`
   *  (the schema box's source — unknown keys tolerated on purpose). */
  output_schema: z.unknown().optional().default(null),
  /**
   * The declarative split (agent-node split plan §2.2) — what makes this
   * agent node a split SOURCE. Absent ⇒ the node is not a source (no
   * behavior change). `field` is the output_schema array field to iterate
   * (already schema-enforced by the output contract, so units are validated
   * data by construction); the *_field members are per-item paths. Nothing
   * reads this yet — Phase 3 wires `splitUnits()` on top of it.
   */
  split: z.object({
    /** the output_schema array field to iterate — REQUIRED, never blank */
    field: z.string().min(1, "split.field is required when split is declared"),
    /** per-unit key: the item path holding the stable unit id */
    key_field: z.string().min(1).default("key"),
    /** where units go by default: a node key or a template id */
    target: z.string().min(1).optional(),
    /** per-item target override path (optional heterogeneous routing) */
    target_field: z.string().min(1).optional(),
    /** per-item dependencies path (string[] of unit keys) */
    depends_on_field: z.string().min(1).default("dependsOn"),
  }).optional(),
  /**
   * How this agent node CONSUMES an upstream split source's output
   * (agent-node split plan §2.4 — Phase 4). The consumer decides (§1):
   * whole = one run with the full upstream output (today's edge semantics,
   * the default); per-unit = the split runtime expands one child run per
   * unit and joins; source = the source def's `splitResolution()` decides.
   * Reads at the engine's split gate via `splitConsumeOf` — a declarative
   * run itself never branches on this.
   */
  split_consume: splitConsumeSchema,
  /** per-unit slot budget for the split scheduler (§3), default 1 = sequential */
  split_parallel_max: splitParallelMaxSchema,
});
export type AgentDef = z.infer<typeof AgentDefSchema>;

export const DecisionDefSchema = z.object({
  source: z.enum(DECISION_SOURCES).default("manual"),
  /** MCP sources for source=agent runs (see AgentDefSchema.mcp_sources) */
  mcp_sources: mcpSourcesSchema,
  /** source=expression (legacy, single global condition): JSONata over the
   *  flow context → the chosen labels. Superseded by per-choice `condition`s
   *  — kept parsed for rows authored before the choice editor grew conditions. */
  expression: z.string().optional().default(""),
  /** source=agent: the decision prompt (how to make the call; {{vars}}
   *  allowed) — the branch list and the JSON return format are appended
   *  automatically by the runtime, so the answer maps to a branch */
  question: z.string().default(""),
  /** variables passed downstream with the pick: field → JSONata over the
   *  flow context, evaluated at run time and merged into the node's output
   *  beside chosen/rationale — every node attached to a branch inherits
   *  them as {{input.<field>}} (source-independent) */
  pass: z.record(z.string(), z.string()).default({}),
  choices: z.array(
    z.object({
      label: z.string().min(1),
      description: z.string().optional(),
      /** source=expression: JSONata over the flow context — truthy picks
       *  this branch (legacy global `expression` still honored when no
       *  choice carries a condition) */
      condition: z.string().optional().default(""),
    }),
  ).min(1, "a decision needs at least one choice"),
});
export type DecisionDef = z.infer<typeof DecisionDefSchema>;

export const HttpDefSchema = z.object({
  /** target URL — {{vars}} and {{secrets.NAME}} allowed, interpolated at run time */
  url: z.string().default(""),
  method: z.enum(HTTP_METHODS).default("GET"),
  headers: z.record(z.string(), z.string()).default({}),
  /** request body as text ({{...}} interpolated); typed by the Content-Type header */
  body: z.string().nullable().default(null),
  timeout_ms: z.number().nonnegative().default(30_000),
  /** optional JSONata over the response {status, ok, body, headers} — must yield an object */
  response_map: z.string().nullable().default(null),
});
export type HttpDef = z.infer<typeof HttpDefSchema>;

export const ScriptDefSchema = z.looseObject({
  runtime: z.enum(SCRIPT_RUNTIMES).default("shell"),
  script: z.string().default(""),
  /** where the script runs: the repo's local checkout, or the flow workspace */
  cwd: z.enum(["repo", "workspace"]).default("repo"),
  timeout_ms: z.number().nonnegative().default(120_000),
  /** env vars passed through to the child process (PATH & HOME always) */
  env: z.array(z.string()).default([]),
  /** optional JSON Schema the output JSON must satisfy. The raw TS-lite
   *  members it was authored from ride along as `output_schema_ts` (the
   *  schema box's source — unknown keys tolerated on purpose, same as the
   *  agent node). */
  output_schema: z.unknown().optional().default(null),
});
export type ScriptDef = z.infer<typeof ScriptDefSchema>;

/** Parse a kind's declarative config, throwing the first problem as a readable Error. */
export function parseDeclarativeConfig(
  kind: string,
  config: unknown,
  name = "node",
): Record<string, unknown> {
  const label = `${name} (${kind})`;
  try {
    switch (kind) {
      case "agent": return AgentDefSchema.parse(config ?? {}) as unknown as Record<string, unknown>;
      case "decision": return DecisionDefSchema.parse(config ?? {}) as unknown as Record<string, unknown>;
      case "http": return HttpDefSchema.parse(config ?? {}) as unknown as Record<string, unknown>;
      case "script": return ScriptDefSchema.parse(config ?? {}) as unknown as Record<string, unknown>;
      default: throw new Error(`unknown declarative kind "${kind}"`);
    }
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e) {
      const zodErr = e as { issues: { path: (string | number)[]; message: string }[] };
      const first = zodErr.issues[0];
      if (first) {
        const at = first.path.length ? ` "${label}.${first.path.join(".")}"` : ` for ${label}`;
        throw new Error(`invalid config${at}: ${first.message}`);
      }
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}
