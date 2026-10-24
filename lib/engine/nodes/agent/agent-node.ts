import { z } from "zod";
import { db } from "../../../db";
import type { NodeRow } from "../../../db/rows";
import type { CursorRunResult } from "../../../integrations/cursor";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../base";
import { templateStore } from "../../templates";
import { extractJson, validateJsonSchema } from "./json-schema-lite";
import { AgentDefSchema, type AgentDef, type AgentInputField } from "../declarative-schemas";
import { buildFlowContext } from "../../flow-context";

export type { AgentDef, AgentInputField };

/**
 * Prompt variables available to `{{expr}}` references in the agent prompt
 * (§3 input mapping context): the shared flow-context map —
 * `{{task.*}}`, `{{repo.*}}`, `{{flow.*}}`, `{{trigger.payload.*}}`, and
 * `{{nodes.<key>.output.*}}` (outputs of upstream nodes, small structured data
 * — large content stays in artifacts and reaches prompts as prompt variables,
 * §5 data-passing rule) — plus `{{input.*}}`: the inherited run input, i.e.
 * the previous node's output fields (the node declares no input contract).
 */
export function agentPromptVars(ctx: FlowCtx): Record<string, unknown> {
  return buildFlowContext(ctx) as unknown as Record<string, unknown>;
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

  /** no declared input contract — the input is the previous node's output */
  override readonly inheritsParentInput = true;

  /** the parsed declarative definition (= the class-layer config) */
  readonly def: AgentDef;

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

    // No declared input contract (§3): the run input is inherited from the
    // previous node's output — everything else reaches the prompt through the
    // flow-context variables. Loose: extra context fields (prompt refs,
    // retries) pass through unenforced.
    this.inputSchema = z.looseObject({
      model: z.string().nullish(),
      prompt: z.string().nullish(),
    }) as z.ZodType<Record<string, unknown>>;

    this.outputSchema = (
      this.def.output === "json"
        ? z.looseObject({})
        : z.looseObject({ markdown: z.string() })
    ) as z.ZodType<Record<string, unknown>>;

    this.description = tmpl.description ?? undefined;
  }

  /**
   * The full authoring form lives in the configurator drawer (not just the
   * create dialog): the prompt is edited in place, after the node is
   * connected, so the upstream run-context variables are clickable chips.
   */
  readonly configFields = [
    {
      key: "mode", label: "Mode", type: "select" as const,
      help: "plan = read-only judgment run; agent = repo workspace run",
      options: [
        { value: "plan", label: "Plan" },
        { value: "agent", label: "Agent" },
      ],
      optionIcons: { plan: "Compass", agent: "Sparkles" },
    },
    {
      key: "prompt", label: "Prompt", type: "text" as const,
      help: "{{...}} references — {{input.*}} (the previous node's output), {{nodes.<key>.output.*}}, {{task.*}} (the starting task), {{repo.*}}, {{flow.*}}, {{trigger.payload.*}} and {{secrets.NAME}}",
    },
    { key: "model", label: "Model override", type: "string" as const, nullable: true, help: "text, or a {{...}} ref — e.g. {{nodes.<key>.output.model}} — empty = the flow's default model" },
    {
      key: "output", label: "Output", type: "select" as const,
      help: "markdown → {{nodes.<key>.output.markdown}} artifact; json → validated payload fields",
      options: [
        { value: "markdown", label: "text", description: "saved as a markdown artifact" },
        { value: "json", label: "json", description: "validated against the output schema" },
      ],
    },
    {
      key: "output_schema", label: "Output schema", type: "ts_output" as const,
      help: "TypeScript-style members (or a JSON Schema) the json output must satisfy",
    },
  ];

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
    // The inherited run input is prompt-addressable: {{input.<field>}} refs the
    // previous node's output fields directly (the node inherits the parent's
    // contract); the engine-owned prompt/model keys are stripped from it.
    const inherited = { ...(rawInput ?? {}) };
    delete inherited.prompt;
    delete inherited.model;
    const rendered = renderAgentPrompt(template, { ...agentPromptVars(ctx), input: inherited });
    const runModel = typeof rawInput.model === "string" && rawInput.model.trim() ? rawInput.model.trim() : null;
    // the model override may itself be a {{...}} ref (an upstream node that
    // picks the model) — rendered against the flow context at run time
    const modelTemplate = runModel ?? cfg.model ?? null;
    const model =
      typeof modelTemplate === "string" && /\{\{[^{}]+\}\}/.test(modelTemplate)
        ? renderAgentPrompt(modelTemplate, agentPromptVars(ctx)).trim() || null
        : modelTemplate;
    const input: Record<string, unknown> = { ...rawInput, prompt: promptBody || null, model };

    return this.execute(ctx, {
      input,
      prompt: rendered,
      promptOverride: promptBody || null,
      agent: {
        mode: cfg.mode,
        name: `${this.label} ${ctx.task.key}`,
        model,
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
        name: `${this.label} ${ctx.task.key}`,
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
