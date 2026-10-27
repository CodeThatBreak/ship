import { z } from "zod";
import { db } from "../../../db";
import type { NodeRow } from "../../../db/rows";
import type { AgentRunResult } from "../../ports/agent-runner";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../base";
import { templateStore } from "../../templates";
import { buildFlowContext } from "../../flow-context";
import { evalJsonata } from "../../jsonata-eval";
import { mcpSourceConfigFields } from "../../node-config";
import { DecisionDefSchema, type DecisionDef } from "../declarative-schemas";
import { extractJson } from "../agent/json-schema-lite";
import { renderAgentPrompt } from "../agent/agent-node";

// ── helpers ──────────────────────────────────────────────────────────────────

/** JSONata truthiness: false / null / "" / 0 are falsy — everything else picks. */
function jsonataTruthy(value: unknown): boolean {
  return !(value === false || value == null || value === "" || value === 0);
}

/**
 * The declarative decision node (§4.3): picks the flow's branch among its
 * outgoing labeled edges. One runtime class per `node_templates` row, sources:
 *
 *  - `expression` — JSONata over the flow context; each choice carries its
 *    own `condition`, every truthy condition picks its branch (legacy rows
 *    may carry a single global `expression` instead).
 *  - `manual`     — the approval UI: the user picks a branch (choose action).
 *  - `agent`      — the user's prompt (how to make the call) + the flow state
 *    go to an agent in plan mode; the return format ({"choice","rationale"}
 *    JSON) is appended automatically so the answer maps to a branch — an
 *    invalid or ambiguous answer fails the node; the engine never silently
 *    picks a branch.
 *
 * Oversight is the trigger type: with `trigger: approval` the (agent- or
 * expression-produced) pick is held at `awaiting_approval`, where the decision
 * card pre-selects it — one click to confirm (`approve_node`), or pick another
 * branch (`choose_node`). Pushback is the existing node chat.
 *
 * Output contract is `{chosen: string[], rationale?: string}` plus any
 * `pass`-mapped variables; each outgoing edge activates exactly when its
 * label ∈ chosen (engine behavior), everything else resolves inactive →
 * downstream skips. Downstream nodes inherit the whole output as their run
 * input (`{{input.<field>}}`), so pass mappings are how variables flow from
 * the decision to further nodes.
 */
export class DecisionTemplateNode extends NodeDefinition<Record<string, unknown>, Record<string, unknown>> {
  readonly key: string;
  readonly label: string;
  readonly promptKeys = [] as const;
  readonly order = 1001;
  readonly retryable = true;

  readonly inputSchema = z.looseObject({}) as z.ZodType<Record<string, unknown>>;
  readonly outputSchema = z.looseObject({
    chosen: z.array(z.string()).default([]),
    rationale: z.string().optional(),
  }) as unknown as z.ZodType<Record<string, unknown>>;

  /** no declared input contract — the input is the previous node's output */
  override readonly inheritsParentInput = true;

  readonly configFields = [
    {
      key: "source", label: "Source", type: "select" as const,
      help: "How the branch is picked",
      options: [
        { value: "manual", label: "Manual", description: "You pick the branch at run time in the decision card" },
        { value: "expression", label: "Expression", description: "Each choice carries a JSONata condition — the truthy conditions pick their branches" },
        { value: "agent", label: "Agent", description: "With your input and prompt, an agent determines which branch to run" },
      ],
    },
    {
      key: "question", label: "Prompt (how to make the decision)", type: "text" as const,
      help: "Type @ to insert an upstream variable — the branch options and the JSON return format are appended automatically, so the agent's answer maps to a branch.",
    },
    {
      key: "choices", label: "Choices", type: "choices" as const,
      help: "The branch labels — outgoing edges must carry a label that matches one of these; descriptions steer an agent classifier, conditions pick branches for the expression source",
    },
    {
      key: "pass", label: "Pass downstream (variables)", type: "map" as const,
      help: "Variables every node attached to a branch receives as {{input.<field>}} — each row maps a field name to a JSONata expression over the flow context (chosen / rationale ride along automatically).",
    },
    // source=agent runs may load ambient MCP servers (Cursor local.settingSources)
    ...mcpSourceConfigFields,
  ];

  /** the parsed declarative definition (= the class-layer config) */
  readonly def: DecisionDef;

  constructor(
    tmpl: { id: string; name: string; description: string | null; config: unknown },
    instanceKey?: string,
  ) {
    super();
    this.key = instanceKey ?? tmpl.id;
    this.label = tmpl.name;
    this.def = DecisionDefSchema.parse(tmpl.config ?? {});
    this.description = tmpl.description ?? undefined;
  }

  /** Display description from the node catalog entry. */
  description?: string;

  override defaultConfig(): Record<string, unknown> {
    return this.def as unknown as Record<string, unknown>;
  }

  /** A decision's labels — the engine validates manual picks against them. */
  choiceLabels(cfg: DecisionDef = this.def): string[] {
    return cfg.choices.map((c) => c.label);
  }

  /** The engine's choose action validates + records a manual branch pick
   *  (with the pass-down variables merged in when the flow ctx is given). */
  async applyChoice(node: NodeRow, flowId: string, chosen: string[], rationale?: string, ctx?: FlowCtx): Promise<void> {
    this.validateChoice(chosen);
    const passed = ctx ? await this.evalPass(this.def, buildFlowContext(ctx)) : {};
    this.support.setNode(node.id, {
      status: "approved",
      output: JSON.stringify({ ...passed, chosen, rationale: rationale ?? "chosen by the user" }),
    });
    db.emitEvent(flowId, node.id, "lifecycle", `branch chosen: ${chosen.join(" + ")}`);
  }

  validateChoice(chosen: string[]): void {
    const labels = this.choiceLabels();
    for (const c of chosen) {
      if (!labels.includes(c)) {
        throw new Error(`"${c}" is not one of this decision's choices: ${labels.join(", ")}`);
      }
    }
    if (new Set(chosen).size !== chosen.length) {
      throw new Error("the same branch was chosen twice");
    }
  }

  /**
   * The decision's published output fields: chosen / rationale + the
   * pass-down variables (each maps a field name → a JSONata expression over
   * the flow context). Downstream nodes' variable chips read from this.
   */
  override outputContract(def: Record<string, unknown> = this.def as unknown as Record<string, unknown>): unknown {
    const props: Record<string, unknown> = {
      chosen: { type: "array", items: { type: "string" }, description: "The picked branch labels" },
      rationale: { type: "string" },
    };
    const pass = def.pass;
    if (pass && typeof pass === "object" && !Array.isArray(pass)) {
      for (const [field, expr] of Object.entries(pass as Record<string, unknown>)) {
        if (field.trim() && typeof expr === "string" && expr.trim()) {
          props[field.trim()] = { description: `passed downstream — ${expr.trim()}` };
        }
      }
    }
    return { type: "object", properties: props, required: ["chosen"] };
  }

  /** The node's choices for the configurator / decision card. */
  override choices(def: Record<string, unknown> = this.def as unknown as Record<string, unknown>): { label: string; description?: string; condition?: string }[] | null {
    const choices = def.choices;
    if (!Array.isArray(choices)) return [];
    return choices
      .filter((c): c is { label: string; description?: string; condition?: string } =>
        !!c && typeof c === "object" && typeof (c as { label?: unknown }).label === "string")
      .map((c) => ({
        label: c.label,
        description: typeof c.description === "string" ? c.description : undefined,
        condition: typeof c.condition === "string" ? c.condition : undefined,
      }));
  }

  async run(ctx: FlowCtx, rawInput: Record<string, unknown>, config: Record<string, unknown>): Promise<RunOutcome> {
    const cfg = this.runConfig(config);
    const node = this.node(ctx);
    // inline paths (manual / expression) — set running, then finish through
    // the shared outcome path (status + output + event) like execute() does
    this.support.setNode(node.id, { status: "running", input: JSON.stringify(rawInput ?? {}) });

    const flowCtx = buildFlowContext(ctx);
    // the pass-down map is source-independent — evaluated once, merged into
    // whichever outcome the pick produces
    const passed = await this.evalPass(cfg, flowCtx);

    if (cfg.source === "manual") {
      // nothing to compute — hold and let the decision card collect the pick
      return this.applyOutcome(ctx, this.awaiting("pick a branch in the decision card", passed));
    }

    if (cfg.source === "expression") {
      // per-choice conditions: each choice's JSONata over the flow context —
      // every truthy condition picks its branch (several may match)
      const conditioned = cfg.choices.filter((c) => (c.condition ?? "").trim());
      if (conditioned.length) {
        const evaluated = await Promise.all(
          conditioned.map(async (c) => ({
            label: c.label,
            r: await evalJsonata((c.condition ?? "").trim(), flowCtx),
          })),
        );
        const failed = evaluated.find((e) => !e.r.ok);
        if (failed) {
          throw new Error(`${this.label}: the condition for "${failed.label}" failed — ${failed.r.error}`);
        }
        const chosen = evaluated.filter((e) => jsonataTruthy(e.r.value)).map((e) => e.label);
        if (!chosen.length) {
          throw new Error(
            `${this.label}: no choice condition matched — every branch stayed inactive (${conditioned.map((c) => c.label).join(", ")})`);
        }
        return this.applyOutcome(ctx, this.applyPick(ctx, chosen, `conditions matched: ${chosen.join(", ")}`, passed));
      }
      // legacy rows: a single global expression instead of per-choice conditions
      if (!cfg.expression?.trim()) {
        throw new Error(`${this.label}: no condition configured — set a JSONata condition on the choices`);
      }
      const r = await evalJsonata(cfg.expression, flowCtx);
      if (!r.ok) throw new Error(`${this.label}: the condition failed — ${r.error}`);
      const chosen = this.normalizeChosen(r.value);
      if (!chosen.length) {
        throw new Error(
          `${this.label}: the condition selected no branch — return a valid choice label (${this.choiceLabels(cfg).join(", ")})`);
      }
      return this.applyOutcome(ctx, this.applyPick(ctx, chosen, `expression match: ${JSON.stringify(r.value)}`, passed));
    }

    // agent classification — constrained structured output, plan mode (read-only).
    // The inherited run input is question-addressable: {{input.<field>}} refs
    // the previous node's output (the node declares no input contract).
    const inherited = { ...(rawInput ?? {}) };
    delete inherited.source;
    return this.execute(ctx, {
      input: { ...rawInput, source: "agent" },
      prompt: this.buildAgentPrompt(cfg, { ...flowCtx, input: inherited }),
      agent: {
        mode: "plan",
        name: `${this.label} ${ctx.task.key}`,
        model: null, // a decision is a judgment call — it uses the flow/default model
        startingRef: ctx.flow.mr_branch ?? undefined,
        settingSources: cfg.mcp_sources,
      },
      label: `${this.label.toLowerCase()} decision`,
      finalize: async (runResult) => {
        const parsed = this.parseAgentChoice(cfg, runResult.result ?? "");
        return this.applyPick(ctx, [parsed.choice], parsed.rationale, passed);
      },
    });
  }

  /** Restart recovery: re-apply the same result through the shared
   * persistence path (applyOutcome) — byte-identical rows to a normal finish,
   * with the note on the event. */
  override async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<boolean> {
    if (result.status !== "finished") return false; // fail it — decision runs are re-runnable
    const cfg = this.runConfig(this.nodeConfig(ctx));
    let outcome: RunOutcome;
    if (cfg.source === "agent") {
      const parsed = this.parseAgentChoice(cfg, result.result ?? "");
      outcome = this.applyPick(ctx, [parsed.choice], parsed.rationale, await this.evalPass(cfg, buildFlowContext(ctx)));
    } else if (cfg.source === "manual") {
      outcome = this.awaiting("pick a branch in the decision card", await this.evalPass(cfg, buildFlowContext(ctx)));
    } else {
      return false; // expression decisions run inline — nothing to recover from
    }
    this.applyOutcome(ctx, outcome, { note });
    return true;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** The effective definition for this run (already merged by the engine). */
  private runConfig(config: Record<string, unknown>): DecisionDef {
    const parsed = DecisionDefSchema.safeParse(config);
    return parsed.success ? parsed.data : this.def;
  }

  /**
   * A pick becomes node output; held at `awaiting_approval` when the
   * template instance's trigger is `approval` (agent proposes, user disposes)
   * — the same contract the agent node uses.
   */
  private applyPick(ctx: FlowCtx, chosen: string[], rationale: string, passed: Record<string, unknown> = {}): RunOutcome {
    const hold = this.holdsForApproval(ctx);
    return {
      status: hold ? "awaiting_approval" : "done",
      output: { ...passed, chosen, rationale },
      event: `${this.label} chose ${chosen.join(" + ")}${hold ? " — awaiting confirmation" : ""}`,
      eventData: { chosen, rationale },
      reply: `**${chosen.join(" + ")}**${rationale ? ` — ${rationale}` : ""}`,
    };
  }

  /** The manual-source hold state: no pick until the user chooses. */
  private awaiting(rationale: string, passed: Record<string, unknown> = {}): RunOutcome {
    return {
      status: "awaiting_approval",
      output: { ...passed, chosen: [], rationale },
      event: `${this.label} is waiting for a branch choice`,
      eventData: { choices: this.choiceLabels() },
      reply: rationale,
    };
  }

  /**
   * The pass-down map: field → JSONata over the flow context, evaluated at
   * run time and merged into the node's output beside chosen / rationale —
   * the inherited-input mechanism then hands every branch's downstream nodes
   * the fields as `{{input.<field>}}`. A broken expression fails the node
   * loudly (the engine never silently drops a mapping).
   */
  private async evalPass(cfg: DecisionDef, flowCtx: Record<string, unknown>): Promise<Record<string, unknown>> {
    const entries = Object.entries(cfg.pass ?? {}).filter(
      ([field, expr]) => field.trim() && typeof expr === "string" && expr.trim(),
    );
    if (!entries.length) return {};
    const out: Record<string, unknown> = {};
    for (const [field, expr] of entries) {
      const r = await evalJsonata(expr.trim(), flowCtx);
      if (!r.ok) {
        throw new Error(`${this.label}: the pass variable "${field}" ("${expr.trim()}") failed — ${r.error}`);
      }
      if (r.value !== undefined) out[field.trim()] = r.value;
    }
    return out;
  }

  /**
   * Build the agent decision prompt: the user's prompt (how to make the
   * decision, `{{vars}}` interpolated via the agent node's interpolation) +
   * the flow-state JSON + the branch list. The return format is appended
   * automatically — the strict {"choice","rationale"} JSON is how the engine
   * maps the answer back onto a branch (outgoing edge label).
   */
  private buildAgentPrompt(cfg: DecisionDef, vars: Record<string, unknown>): string {
    const choices = cfg.choices.map((c) => `- ${c.label}: ${c.description ?? ""}`.trim()).join("\n");
    const prompt = renderAgentPrompt(cfg.question || "Choose the next step for this flow.", vars);
    return [
      `You are deciding the next branch for the "${this.label}" step of a workflow.`,
      "",
      "Decision instructions (how to choose):",
      prompt,
      "",
      "Flow state (JSON):",
      JSON.stringify(vars, null, 2),
      "",
      "The branch you pick must be exactly one of these labels:",
      choices,
      "",
      'Return format — respond ONLY with a JSON object: {"choice": "<one of the branch labels above>", "rationale": "<1-2 sentences explaining the pick>"}.',
      "Do not modify any files — this is a read-only judgment call.",
    ].join("\n");
  }

  private parseAgentChoice(cfg: DecisionDef, text: string): { choice: string; rationale: string } {
    const label = this.label;
    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `${label}: the agent response contained no decision JSON — expected {"choice": "...", "rationale": "..."}`);
    }
    const choiceRaw = (parsed as Record<string, unknown>).choice;
    const rationale = String((parsed as Record<string, unknown>).rationale ?? "").trim();
    if (typeof choiceRaw !== "string" || !choiceRaw.trim()) {
      throw new Error(`${label}: the agent did not return a "choice" label — retry to ask again`);
    }
    const choice = choiceRaw.trim();
    // case-insensitive labels are a common agent slip — normalize instead of failing
    const labels = this.choiceLabels(cfg);
    const exact = labels.find((l) => l === choice) ?? labels.find((l) => l.toLowerCase() === choice.toLowerCase());
    if (!exact) {
      throw new Error(
        `${label}: the agent returned "${choice}", which is not one of the choice labels (${labels.join(", ")}) — retry to ask again`);
    }
    return { choice: exact, rationale };
  }

  /** JSONata value → validated choice list (§4.3: no silent picks). */
  private normalizeChosen(value: unknown): string[] {
    const labels = this.choiceLabels();
    const items: unknown[] =
      typeof value === "string" ? [value] :
      Array.isArray(value) ? value : [];
    const chosen: string[] = [];
    for (const item of items) {
      const s = String(item);
      if (!labels.includes(s)) {
        throw new Error(
          `${this.label}: the condition produced "${s}", which is not one of the choice labels (${labels.join(", ")})`);
      }
      if (!chosen.includes(s)) chosen.push(s);
    }
    return chosen;
  }

  holdsForApproval(ctx: FlowCtx): boolean {
    const g = templateStore.graphForFlow(ctx.flow.id);
    const spec = g?.byKey.get(this.key);
    return spec?.trigger.type === "approval";
  }
}
