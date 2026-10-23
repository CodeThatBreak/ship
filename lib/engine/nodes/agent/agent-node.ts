import { z } from "zod";
import { db } from "../../../db";
import type { NodeRow } from "../../../db/rows";
import type { CursorRunResult } from "../../../integrations/cursor";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../base";
import { templateStore } from "../../templates";
import { extractJson, validateJsonSchema } from "./json-schema-lite";

// ── the declarative agent-node definition (node_templates.config) ────────────

/** One declared input field of an agent node (drives the contract + input map). */
export interface AgentInputField {
  key: string;
  label?: string;
  /** string | number | boolean — for the contract display (Phase 3 wires input maps) */
  type?: "string" | "number" | "boolean";
  required?: boolean;
}

/**
 * The full definition stored on a `node_templates` row with kind='agent'
 * (§4.2 of the custom-flows plan). Class defaults ← app settings ← template
 * node config ← flow instance config all fold into `config` when a run starts.
 */
const AgentDefSchema = z.object({
  prompt: z.string().default(""),
  /** plan = read-only judgment run; agent = repo workspace run */
  mode: z.enum(["plan", "agent"]).default("plan"),
  /** null = the flow/default model (settings.default_model) */
  model: z.string().nullable().default(null),
  /** markdown → {markdown} output + markdown artifact; json → validated payload */
  output: z.enum(["markdown", "json"]).default("markdown"),
  /** when output=json: JSON Schema the response must satisfy */
  output_schema: z.unknown().optional().default(null),
  /** declared inputs (contract display; input mapping evaluates in Phase 3) */
  inputs: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().optional(),
      type: z.enum(["string", "number", "boolean"]).optional(),
      required: z.boolean().optional(),
    }),
  ).default([]),
});

export type AgentDef = z.infer<typeof AgentDefSchema>;

/**
 * Prompt variables available to `{{expr}}` references in the agent prompt:
 * `{{ticket.*}}`, `{{repo.*}}`, `{{flow.*}}`, `{{trigger.payload.*}}`, and
 * `{{nodes.<key>.output.*}}` (outputs of upstream nodes, small structured data
 * — large content stays in artifacts and reaches prompts as prompt variables,
 * §5 data-passing rule).
 */
export function agentPromptVars(ctx: FlowCtx): Record<string, unknown> {
  const nodes: Record<string, unknown> = {};
  const rowsOut = db.all<{ node_key: string; output: unknown }>(
    `SELECT node_key, output FROM nodes WHERE flow_id=?`, ctx.flow.id
  );
  for (const r of rowsOut) {
    nodes[r.node_key] = { output: (r.output ?? {}) as Record<string, unknown> };
  }
  let payload: unknown = null;
  if ((ctx.flow as Record<string, unknown>).trigger_payload) {
    payload = (ctx.flow as Record<string, unknown>).trigger_payload;
  }
  return {
    ticket: {
      key: ctx.ticket.key,
      summary: ctx.ticket.summary,
      description: ctx.ticket.description ?? "",
      prd: ctx.ticket.prdText ?? "",
    },
    repo: {
      cloud_url: ctx.repo?.cloud_url ?? ctx.flow.repo_url ?? "",
      local_path: ctx.repo?.local_path ?? "",
    },
    flow: {
      mr_url: ctx.flow.mr_url ?? "",
      mr_branch: ctx.flow.mr_branch ?? "",
    },
    trigger: { payload },
    nodes,
  };
}

/** `{{a.b.c}}` interpolation against the flow variable map. */
export function renderAgentPrompt(prompt: string, vars: Record<string, unknown>): string {
  return (prompt ?? "").replace(/\{\{([^{}]+)\}\}/g, (_, raw: string) => {
    const segments = raw.trim().split(".");
    let v: unknown = vars;
    for (const seg of segments) {
      if (v == null || typeof v !== "object") {
        v = undefined;
        break;
      }
      v = (v as Record<string, unknown>)[seg];
    }
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  });
}

/**
 * The runtime class behind every `node_templates` row with kind='agent'
 * (§4.2): one instance per (row, instance key). The prompt node declares
 * inputs/outputs statically (they show in the configurator), renders
 * PromptLibrary-style variables, and reuses the standard agent run lifecycle —
 * status, streaming, cost, artifacts, output validation. No new infrastructure.
 */
export class AgentTemplateNode extends NodeDefinition<Record<string, unknown>, Record<string, unknown>> {
  readonly key: string;
  readonly label: string;
  readonly promptKeys = [] as const;
  readonly order = 1000;
  readonly retryable = true;

  readonly inputSchema: z.ZodType<Record<string, unknown>>;
  readonly outputSchema: z.ZodType<Record<string, unknown>>;

  /** the parsed declarative definition (= the class-layer config) */
  readonly def: AgentDef;
  /** declared input fields, for the configurator contract tab */
  readonly declaredInputs: AgentInputField[];

  constructor(
    tmpl: { id: string; name: string; description: string | null; config: unknown },
    instanceKey?: string,
  ) {
    super();
    // The def key (registry resolution) is the node_templates row id, but the
    // node row's node_key is the template instance key — every def ⇄ row
    // lookup (this.node(ctx)) keys on the instance key, so this.key carries it.
    this.key = instanceKey ?? tmpl.id;
    this.label = tmpl.name;
    this.def = AgentDefSchema.parse(tmpl.config ?? {});
    this.declaredInputs = this.def.inputs;

    const shape: Record<string, z.ZodTypeAny> = {
      model: z.string().nullish(),
      prompt: z.string().nullish(),
    };
    for (const f of this.def.inputs) {
      shape[f.key] =
        f.type === "number" ? z.number().nullish() :
        f.type === "boolean" ? z.boolean().nullish() :
        z.string().nullish();
    }
    // loose: extra context fields from the engine (prompt refs, retries) pass through
    this.inputSchema = z.looseObject(shape) as z.ZodType<Record<string, unknown>>;

    this.outputSchema = (
      this.def.output === "json"
        ? z.looseObject({})
        : z.looseObject({ markdown: z.string() })
    ) as z.ZodType<Record<string, unknown>>;

    this.description = tmpl.description ?? undefined;
  }

  /** Display description from the node catalog entry. */
  description?: string;

  /** Class-layer config = the declarative definition itself. */
  override defaultConfig(): Record<string, unknown> {
    return this.def as unknown as Record<string, unknown>;
  }

  /**
   * Run the agent: render the prompt against flow variables, execute through
   * the shared run lifecycle, then validate/shape the output contract.
   */
  async run(ctx: FlowCtx, rawInput: Record<string, unknown>, config: Record<string, unknown>): Promise<RunOutcome> {
    const cfg = this.runConfig(config);
    const promptBody = typeof rawInput.prompt === "string" ? rawInput.prompt.trim() : "";
    const template = promptBody || cfg.prompt;
    if (!template.trim()) {
      throw new Error(`${this.label}: no prompt configured — set one in the template editor`);
    }
    const rendered = renderAgentPrompt(template, agentPromptVars(ctx));
    const runModel = typeof rawInput.model === "string" && rawInput.model.trim() ? rawInput.model.trim() : null;
    const input: Record<string, unknown> = { ...rawInput, prompt: promptBody || null, model: runModel ?? cfg.model };

    return this.execute(ctx, {
      input,
      prompt: rendered,
      promptOverride: promptBody || null,
      agent: {
        mode: cfg.mode,
        name: `${this.label} ${ctx.ticket.key}`,
        model: runModel ?? cfg.model,
        startingRef: ctx.flow.mr_branch ?? undefined,
      },
      label: this.label.toLowerCase(),
      finalize: async (result) => this.applyOutput(ctx, result.result ?? "", cfg),
    });
  }

  /** Chat refinement: a follow-up run on the node's existing agent. */
  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    const cfg = this.runConfig(this.nodeConfig(ctx));
    const rendered = renderAgentPrompt(content, agentPromptVars(ctx));
    return this.execute(ctx, {
      input: { model: model ?? null, feedback: content },
      prompt: rendered,
      agent: {
        mode: cfg.mode,
        name: `${this.label} ${ctx.ticket.key}`,
        model: model ?? cfg.model ?? null,
        startingRef: ctx.flow.mr_branch ?? undefined,
        followUpOn: this.support.lastAgentId(this.node(ctx).id),
      },
      label: `${this.label.toLowerCase()} follow-up`,
      finalize: async (result) => this.applyOutput(ctx, result.result ?? "", cfg),
    }).then((o) => o.reply);
  }

  /** Restart recovery: re-apply the same output contract to a finished run. */
  async recover(ctx: FlowCtx, node: NodeRow, result: CursorRunResult, note: string): Promise<boolean> {
    if (result.status !== "finished") return false;
    const cfg = this.runConfig(this.nodeConfig(ctx));
    const outcome = this.applyOutput(ctx, result.result ?? "", cfg);
    const output = this.outputSchema.parse(outcome.output);
    this.support.setNode(node.id, {
      status: outcome.status,
      agent_id: this.support.lastAgentId(node.id),
      output: JSON.stringify(output),
    });
    if (outcome.artifact) {
      this.support.saveArtifact(node.id, ctx.flow.id, outcome.artifact.kind, outcome.artifact.content, outcome.artifact.meta);
    }
    db.emitEvent(ctx.flow.id, node.id, "lifecycle", `${outcome.event} (${note})`);
    return true;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** The effective definition for this run (already merged by the engine). */
  private runConfig(config: Record<string, unknown>): AgentDef {
    const parsed = AgentDefSchema.safeParse(config);
    return parsed.success ? parsed.data : this.def;
  }

  /**
   * Shape the agent's text into the declared output contract. `output: json`
   * validates against the declared JSON Schema and fails the node loudly on a
   * bad response; `output: markdown` saves the text as an artifact and publishes
   * `{{nodes.<key>.output.markdown}}`.
   */
  private applyOutput(ctx: FlowCtx, text: string, cfg: AgentDef): RunOutcome {
    const hold = this.holdsForApproval(ctx);
    if (cfg.output === "json") {
      const parsed = extractJson(text);
      if (parsed == null) {
        throw new Error(`${this.label}: the agent response contained no JSON — the node's output format is configured as json`);
      }
      validateJsonSchema(cfg.output_schema, parsed, this.label);
      const output = parsed as Record<string, unknown>;
      return {
        status: hold ? "awaiting_approval" : "done",
        output,
        artifact: { kind: "json", content: JSON.stringify(output, null, 2) },
        event: `${this.label} output ready${hold ? " — awaiting approval" : ""}`,
        eventData: { output_format: "json" },
        reply: "```json\n" + JSON.stringify(output, null, 2) + "\n```",
      };
    }
    const body = (text ?? "").trim() || "(empty response)";
    return {
      status: hold ? "awaiting_approval" : "done",
      output: { markdown: body },
      artifact: { kind: "markdown", content: body },
      event: `${this.label} output ready${hold ? " — awaiting approval" : ""}`,
      eventData: { output_format: "markdown" },
      reply: body,
    };
  }

  /**
   * Approval-triggered node instances hold at `awaiting_approval` after a
   * successful run; outgoing edges activate on the generic approve action.
   * The trigger type lives on the template instance (looked up by node_key).
   */
  private holdsForApproval(ctx: FlowCtx): boolean {
    const g = templateStore.graphForFlow(ctx.flow.id);
    const spec = g?.byKey.get(this.key);
    return spec?.trigger.type === "approval";
  }
}
