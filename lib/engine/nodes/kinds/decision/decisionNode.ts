import "server-only";

import { z } from "zod";
import type { NodeRow } from "../../../../db/rows";
import type { AgentRunResult } from "../../../ports/agentPort";
import type { RecoveryResult } from "../../shared/types/recovery";
import { type FlowCtx, type RunOutcome } from "../../shared/nodeSharedExports";
import { DeclarativeAgentNode } from "../../shared/declarativeNode";
import { buildFlowContext } from "../../../context/flowVariables";
import { evalJsonata, jsonataTruthy } from "@/lib/jsonata/eval";
import { mcpSourceConfigFields } from "../../../templates/nodeConfig";
import { DecisionDefSchema, type DecisionDef } from "../../declarativeSchemas";
import { AgentOutputPipeline } from "../../shared/agentOutput/agentOutputPipeline";
import { validateStandardAgentOutput } from "../../shared/agentOutput/utils/standardOutput";
import { DecisionRunInput, decisionModelOverride, decisionOutputContract, DecisionAgentChoice } from "./schema";
import { buildDecisionAgentPrompt, decisionRetryPrompt } from "./utils/decisionPrompt";
import { nodeRoles, type NodePromptPreview, type PromptPreviewParams } from "../../shared/nodeSharedExports";

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * The declarative decision node (§4.3): picks the flow's branch among its
 * outgoing labeled edges. One runtime class per `node_templates` row, sources:
 *
 *  - `expression` — JSONata over the flow context; each choice carries its
 *    own `condition`, every truthy condition picks its branch.
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
 * choose another branch (`choose_node`). Chat is declined (§T4: no `refinable`
 * capability — pushing back happens through the decision card, not a rerun);
 * conversational follow-ups ride the agent-run tier's `converse`.
 *
 * Output contract is `{chosen: string[], rationale?: string}` plus any
 * `pass`-mapped variables; each outgoing edge activates exactly when its
 * label ∈ chosen (engine behavior), everything else resolves inactive →
 * downstream skips. Downstream nodes inherit the whole output as their run
 * input (`{{input.<field>}}`), so pass mappings are how variables flow from
 * the decision to further nodes.
 */
export class DecisionTemplateNode extends DeclarativeAgentNode<DecisionDef, Record<string, unknown>, Record<string, unknown>> {
  readonly promptKeys = [] as const;
  readonly order = 1001;
  override readonly retryable = true;

  readonly inputSchema: z.ZodType<Record<string, unknown>>;
  /** the REAL output contract — chosen/rationale strict, plus one field per
   *  `pass` key (see ./schema) */
  readonly outputSchema: z.ZodType<Record<string, unknown>>;

  /** no declared input contract — the input is the previous node's output */
  override readonly inheritsParentInput = true;

  override readonly configFields = [
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

  declare readonly def: DecisionDef;

  /** the ONE agent-output path for this kind's agent pick (step 05) */
  private readonly outputPipeline: AgentOutputPipeline;

  constructor(
    tmpl: { id: string; name: string; description: string | null; config: unknown },
    instanceKey?: string,
  ) {
    super(tmpl, instanceKey, DecisionDefSchema.parse(tmpl.config ?? {}), "decision");
    this.inputSchema = DecisionRunInput;
    this.outputPipeline = new AgentOutputPipeline(this.support);
    // the REAL output contract (step 04): built once per instance — the
    // declarative def cache holds instances
    this.outputSchema = decisionOutputContract(this.def);
  }

  /** A decision's labels — the engine validates manual picks against them. */
  choiceLabels(cfg: DecisionDef = this.def): string[] {
    return cfg.choices.map((c) => c.label);
  }

  /** The engine's choose action validates + records a manual branch pick
   *  (with the pass-down variables merged in when the flow ctx is given). */
  async applyChoice(node: NodeRow, flowId: string, chosen: string[], rationale: string | undefined, ctx: FlowCtx): Promise<void> {
    const cfg = this.runConfig(await this.nodeConfig(ctx));
    this.validateChoice(chosen, cfg);
    const passed = await this.evalPass(cfg, await buildFlowContext(ctx));
    // the manual pick's output must satisfy the node's own contract BEFORE it
    // is written (step 04: nothing is published unvalidated) — a violation
    // throws loudly here, before the transition
    const output = this.outputSchema.parse({ ...passed, chosen, rationale: rationale ?? "chosen by the user" });
    // declared transition (awaiting_approval → approved) with the choice output
    await this.support.applyTransition(flowId, node.nodeKey, "chooseBranch", {
      patch: { output: JSON.stringify(output) },
    });
    await this.support.emitLifecycle(flowId, node.id, `branch chosen: ${chosen.join(" + ")}`);
  }

  validateChoice(chosen: string[], cfg: DecisionDef = this.def): void {
    const labels = this.choiceLabels(cfg);
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
   * Live prompt preview (step 05): the agent-source decision prompt a fresh
   * run would send — `buildDecisionAgentPrompt` over the flow context plus the
   * inherited input (the node's recorded input minus the engine-owned
   * `source` key, the same shape `run()` passes), so preview === run bytes.
   * The decision prompt carries a built-in fallback question, so a def
   * without a configured question still previews.
   */
  async previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): Promise<NodePromptPreview | null> {
    void params;
    const cfg = this.runConfig(await nodeRoles.previewConfig(this, node));
    const flowCtx = await buildFlowContext(ctx);
    const recorded =
      node?.input != null && typeof node.input === "object" && !Array.isArray(node.input)
        ? (node.input as Record<string, unknown>)
        : {};
    const { source: _, ...inherited } = recorded;
    void _;
    const prompt = buildDecisionAgentPrompt(this.label, cfg, { ...flowCtx, input: inherited });
    return {
      templateKey: this.declarativeKind,
      configBody: cfg.question || null,
      assembly: { body: prompt, blocks: [], final: prompt },
    };
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
    const node = await this.node(ctx);
    // inline paths (manual / expression) — record the run input (the stage
    // claim already holds the node running), then finish through the shared
    // outcome path (status + output + event) like execute() does
    await this.support.setNode(node.id, { input: JSON.stringify(rawInput ?? {}) });

    const flowCtx = await buildFlowContext(ctx);
    // the pass-down map is source-independent — evaluated once, merged into
    // whichever outcome the pick produces
    const passed = await this.evalPass(cfg, flowCtx);

    if (cfg.source === "manual") {
      // nothing to compute — hold and let the decision card collect the pick
      return await this.applyOutcome(ctx, this.awaiting("pick a branch in the decision card", passed, cfg));
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
        return await this.applyOutcome(ctx, await this.applyPick(ctx, chosen, `conditions matched: ${chosen.join(", ")}`, passed));
      }
      throw new Error(`${this.label}: no condition configured — set a JSONata condition on the choices`);
    }

    // agent classification — constrained structured output, plan mode (read-only).
    // The inherited run input is question-addressable: {{input.<field>}} refs
    // the previous node's output (the node declares no input contract).
    const inherited = { ...(rawInput ?? {}) };
    delete inherited.source;
    // the per-run model override, resolved ONCE — the main run and the
    // pipeline's bounded retry turn pass the SAME resolved model (prompt
    // audit #11; null = the flow/default model)
    const model = decisionModelOverride(rawInput ?? {});
    return this.execute(ctx, {
      input: { ...rawInput, source: "agent", model },
      prompt: buildDecisionAgentPrompt(this.label, cfg, { ...flowCtx, input: inherited }),
      agent: {
        mode: "plan",
        name: `${this.label} ${ctx.task.key}`,
        model,
        startingRef: ctx.flow.mrBranch ?? undefined,
        settingSources: cfg.mcp_sources,
      },
      label: `${this.label.toLowerCase()} decision`,
      finalize: async (runResult) => {
        const parsed = await this.pickFromAgent(ctx, node, cfg, runResult.result ?? "", model);
        return await this.applyPick(ctx, [parsed.choice], parsed.rationale, passed);
      },
    });
  }

  /** Restart recovery: re-apply the same result through the shared
   * persistence path (applyOutcome) — byte-identical rows to a normal finish,
   * with the note on the event. A malformed recorded pick is `manual` with
   * the parse failure as the reason (never a throw — the fixed recovery
   * ABI). */
  override async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<RecoveryResult> {
    if (result.status !== "finished") {
      return { kind: "manual", reason: `the decision run ended with ${result.status} — decision runs are re-runnable` };
    }
    const cfg = this.runConfig(await this.nodeConfig(ctx));
    try {
      if (cfg.source === "agent") {
        const parsed = this.parseAgentChoice(cfg, result.result ?? "");
        const outcome = await this.applyPick(ctx, [parsed.choice], parsed.rationale, await this.evalPass(cfg, await buildFlowContext(ctx)));
        await this.applyOutcome(ctx, outcome, { note });
      } else if (cfg.source === "manual") {
        const outcome = this.awaiting("pick a branch in the decision card", await this.evalPass(cfg, await buildFlowContext(ctx)), cfg);
        await this.applyOutcome(ctx, outcome, { note });
      } else {
        return { kind: "manual", reason: "expression decisions run inline — nothing to recover from" };
      }
      return { kind: "recovered" };
    } catch (e: unknown) {
      return { kind: "manual", reason: `re-applying the recorded pick failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * A pick becomes node output; held at `awaiting_approval` when the
   * template instance's trigger is `approval` (agent proposes, user disposes)
   * — the same contract the agent node uses.
   */
  private async applyPick(ctx: FlowCtx, chosen: string[], rationale: string, passed: Record<string, unknown> = {}): Promise<RunOutcome> {
    const hold = await this.holdsForApproval(ctx);
    return {
      status: hold ? "awaiting_approval" : "done",
      output: { ...passed, chosen, rationale },
      event: `${this.label} chose ${chosen.join(" + ")}${hold ? " — awaiting confirmation" : ""}`,
      eventData: { chosen, rationale },
      reply: `**${chosen.join(" + ")}**${rationale ? ` — ${rationale}` : ""}`,
    };
  }

  /** The manual-source hold state: no pick until the user chooses. */
  private awaiting(rationale: string, passed: Record<string, unknown> = {}, cfg: DecisionDef = this.def): RunOutcome {
    return {
      status: "awaiting_approval",
      output: { ...passed, chosen: [], rationale },
      event: `${this.label} is waiting for a branch choice`,
      eventData: { choices: this.choiceLabels(cfg) },
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
   * The agent pick through the ONE agent-output pipeline (step 05): the
   * contract with its bounded feedback retry (`retryBudget`), the typed
   * events on every outcome.
   */
  private async pickFromAgent(ctx: FlowCtx, node: NodeRow, cfg: DecisionDef, text: string, model: string | null): Promise<{ choice: string; rationale: string }> {
    return this.outputPipeline.run<{ choice: string; rationale: string }>({
      ctx,
      nodeId: node.id,
      label: this.label,
      text,
      budget: this.retryBudget,
      validate: (t) => this.parseAgentChoice(cfg, t),
      retryPrompt: (failure) => decisionRetryPrompt(this.label, failure),
      executeRetry: async (prompt) => {
        const { result: retry } = await this.runner.executeRun(
          ctx,
          node.id,
          async () =>
            this.runner.startAgent(ctx, {
              prompt,
              mode: "plan",
              name: `${this.label} ${ctx.task.key}`,
              // the SAME resolved model the main run started with (audit #11)
              model,
              followUpOn: await this.support.lastAgentId(node.id),
              settingSources: cfg.mcp_sources,
            }),
          `${this.label.toLowerCase()} decision retry`,
        );
        return retry.result ?? "";
      },
    });
  }

  /**
   * Validate the agent's choice against the contract (step 05 — the standard
   * shared validation; the case-insensitive label salvage is DELETED: a label
   * that is not exactly one of the choices is a typed schema_mismatch the
   * pipeline's feedback retry can fix).
   */
  private parseAgentChoice(cfg: DecisionDef, text: string): { choice: string; rationale: string } {
    const parsed = validateStandardAgentOutput({
      label: this.label,
      text,
      schema: DecisionAgentChoice,
      noJsonNote: 'expected {"choice": "...", "rationale": "..."}',
      mismatchNote: `${this.label}: the decision response violated its schema`,
      semantic: (value) => {
        const labels = this.choiceLabels(cfg);
        if (!labels.includes(value.choice)) {
          return [{
            path: "choice",
            message: `${this.label}: the agent returned "${value.choice}", which is not one of the choice labels (${labels.join(", ")})`,
          }];
        }
        return [];
      },
    });
    return { choice: parsed.choice, rationale: parsed.rationale ?? "" };
  }
}

import { declarativeKindRegistry } from "../../declarativeRegistry";
import type { NodeDefinition } from "../../shared/nodeDefinition";

declarativeKindRegistry.register("decision", DecisionDefSchema, (row, inst) =>
  new DecisionTemplateNode(row, inst) as NodeDefinition<unknown, Record<string, unknown>>);
