import { z } from "zod";

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
  mode: z.enum(["plan", "agent"]).default("plan"),
  /** null = the flow/default model (settings.default_model) */
  model: z.string().nullable().default(null),
  /** markdown → {markdown} output + markdown artifact; json → validated payload */
  output: z.enum(["markdown", "json"]).default("markdown"),
  /** when output=json: JSON Schema the response must satisfy. The raw
   *  TypeScript members it was authored from ride along as `output_schema_ts`
   *  (the schema box's source — unknown keys tolerated on purpose). */
  output_schema: z.unknown().optional().default(null),
});
export type AgentDef = z.infer<typeof AgentDefSchema>;

export const DECISION_SOURCES = ["expression", "manual", "agent"] as const;

export const DecisionDefSchema = z.object({
  source: z.enum(DECISION_SOURCES).default("manual"),
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

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

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

export const SCRIPT_RUNTIMES = ["shell", "node", "python"] as const;

export const ScriptDefSchema = z.object({
  runtime: z.enum(SCRIPT_RUNTIMES).default("shell"),
  script: z.string().default(""),
  /** where the script runs: the repo's local checkout, or the flow workspace */
  cwd: z.enum(["repo", "workspace"]).default("repo"),
  timeout_ms: z.number().nonnegative().default(120_000),
  /** env vars passed through to the child process (PATH & HOME always) */
  env: z.array(z.string()).default([]),
  /** optional JSON Schema the output JSON must satisfy */
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
