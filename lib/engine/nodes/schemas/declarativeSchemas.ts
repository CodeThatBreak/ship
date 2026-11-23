import "server-only";

import { z } from "zod";
import { mcpSourcesSchema } from "../../templates/schemas/mcpSources";
import { FACT_KIND, NEEDABLE_FACTS, PRODUCIBLE_FACTS } from "../../facts/types/facts";
import {
  EFFECT_VERBS_AFTER_APPROVAL,
  EFFECT_VERBS_AFTER_SUCCESS,
} from "../../runtime/effects/constants/effectVerbs";
import {
  AGENT_MODE,
  AGENT_MODES,
  AGENT_OUTPUT_FORMAT,
  AGENT_OUTPUT_FORMATS,
  DECISION_SOURCES,
  HTTP_METHODS,
  SCRIPT_RUNTIMES,
} from "../../constants/declarative";
import { AGENT_TOOL, AGENT_TOOL_NAMES } from "../../agentTools/constants/agentTools";

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
} from "../../constants/declarative";
export type { AgentMode, AgentOutputFormat } from "../../constants/declarative";

/**
 * The declarative effects map (task 10, design §4.2): what the engine should
 * DO after one of the node's lifecycles fires. Verbs are a closed union
 * (`EFFECT_VERB`) — the config composes registered verbs, it never invents
 * them; the declarative wildcard effects read this map at dispatch time
 * (relevance from config, never a def key — Invariant F1).
 */
const DeclarativeEffectsSchema = z
  .object({
    afterApproval: z.array(z.enum(EFFECT_VERBS_AFTER_APPROVAL)).default([]),
    afterSuccess: z.array(z.enum(EFFECT_VERBS_AFTER_SUCCESS)).default([]),
  })
  .default({ afterApproval: [], afterSuccess: [] });

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
  /** branch/ref the runs start from — text or a `{{...}}` ref, rendered
   * against the flow context at run time; null = the flow's MR branch
   * (resolved through the kind's one `resolveStartingRef` seam) */
  base_ref: z.string().nullable().default(null),
  /** bounded feedback retries the json output contract may spend (0 = the
   * first miss is terminal); read via the kind's `retryBudgetOf` — config
   * wins, the class default is the fallback */
  retry_budget: z.number().int().min(0).max(5).default(1),
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
   * The git side effects this node's runs may establish (Task 06, Invariant
   * F4): `result.git` is consumed only for the declared kinds — an explicit
   * `produces: []` drops them all. Facts persist through the FactStore inside
   * the terminal write's batch (Invariant F2). `change_request` is not
   * producible — MRs are established by the `create_change_request` verb
   * (Phase 3), never directly by a run.
   *
   * Hidden from the authoring form to keep it simple: new templates get both
   * kinds by default. Existing templates keep whatever their stored config
   * already says, and an explicit `[]` remains the per-template opt-out.
   */
  produces: z.array(z.enum(PRODUCIBLE_FACTS)).default([FACT_KIND.BRANCH, FACT_KIND.DIFF]),
  /**
   * The engine tools this node's running agent may call (task 13, Invariant
   * 10): the AgentToolService authorizes against the kind's `agentTools()`
   * allowlist ∩ this declared set — a declaration can only narrow the kind's
   * allowlist, never widen it. The default preserves today's behavior
   * exactly (the agent-run tier's read + report_failure pair).
   */
  agent_tools: z.array(z.enum(AGENT_TOOL_NAMES)).default([
    AGENT_TOOL.READ_FLOW_STATE,
    AGENT_TOOL.REPORT_FAILURE,
  ]),
  /**
   * The flow secrets this node's runs may use (task 15, design §7, finding
   * C1): each ref resolves through the SecretStore at run start — the values
   * ride `AgentStartSpec.env` (never persisted, never recorded) and unlock
   * `{{secrets.NAME}}` in the prompt. A prompt ref not declared here fails
   * the run loudly; a declared ref with no configured value fails loudly too.
   */
  secret_refs: z.array(z.string()).default([]),
  /** the declarative effects map (task 10) — see DeclarativeEffectsSchema */
  effects: DeclarativeEffectsSchema,
  /**
   * The facts this node REQUIRES an upstream node to establish (task 14,
   * design §4.1): the static satisfiability check in template lint fails
   * save/import when no upstream `produces`/`effects` declaration can
   * establish a declared need. Declarations only — runtime facts are never
   * chased at lint time.
   */
  needs: z.array(z.enum(NEEDABLE_FACTS)).default([]),
});
export type AgentDef = z.infer<typeof AgentDefSchema>;

export const DecisionDefSchema = z.object({
  source: z.enum(DECISION_SOURCES).default("manual"),
  /** MCP sources for source=agent runs (see AgentDefSchema.mcp_sources) */
  mcp_sources: mcpSourcesSchema,
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
      /** source=expression: JSONata over the flow context — truthy picks this branch */
      condition: z.string().optional().default(""),
    }),
  ).min(1, "a decision needs at least one choice"),
  /** the declarative effects map (task 10) — see DeclarativeEffectsSchema */
  effects: DeclarativeEffectsSchema,
  /** the declared fact needs (task 14) — see AgentDefSchema.needs */
  needs: z.array(z.enum(NEEDABLE_FACTS)).default([]),
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
  /** the declarative effects map (task 10) — see DeclarativeEffectsSchema */
  effects: DeclarativeEffectsSchema,
  /** the declared fact needs (task 14) — see AgentDefSchema.needs */
  needs: z.array(z.enum(NEEDABLE_FACTS)).default([]),
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
  /** the declarative effects map (task 10) — see DeclarativeEffectsSchema */
  effects: DeclarativeEffectsSchema,
  /** the declared fact needs (task 14) — see AgentDefSchema.needs */
  needs: z.array(z.enum(NEEDABLE_FACTS)).default([]),
});
export type ScriptDef = z.infer<typeof ScriptDefSchema>;

