import { z } from "zod";
import { db } from "../../../db";
import type { NodeRow } from "../../../db/rows";
import type { CursorRunResult } from "../../../integrations/cursor";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../base";
import { templateStore } from "../../templates";
import { buildFlowContext } from "../../flow-context";
import { evalJsonata } from "../../jsonata-eval";
import { DecisionDefSchema, type DecisionDef } from "../declarative-schemas";
import { extractJson } from "../agent/json-schema-lite";
import { renderAgentPrompt } from "../agent/agent-node";

/**
 * The declarative decision node (§4.3): picks the flow's branch among its
 * outgoing labeled edges. One runtime class per `node_templates` row, sources:
 *
 *  - `expression` — JSONata over the flow context; fully deterministic.
 *  - `manual`     — the approval UI: the user picks a branch (choose action).
 *  - `agent`      — an agent classifies the flow state into one choice. The
 *    prompt is auto-built from the user's `question` + per-choice
 *    `description`s (not free-form); the agent runs in plan mode and must
 *    return {"choice": label, "rationale": …} — an invalid or ambiguous answer
 *    fails the node; the engine never silently picks a branch.
 *
 * Oversight is the trigger type: with `trigger: approval` the (agent- or
 * expression-produced) pick is held at `awaiting_approval`, where the decision
 * card pre-selects it — one click to confirm (`approve_node`), or pick another
 * branch (`choose_node`). Pushback is the existing node chat.
 *
 * Output contract is fixed: `{chosen: string[], rationale?: string}`; each
 * outgoing edge activates exactly when its label ∈ chosen (engine behavior),
 * everything else resolves inactive → downstream skips.
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
        { value: "expression", label: "expression — JSONata condition (deterministic)" },
        { value: "manual", label: "manual — you pick a branch at run time" },
        { value: "agent", label: "agent — classify the flow state (plan-mode agent)" },
      ],
    },
    {
      key: "expression", label: "Expression (source=expression)", type: "text" as const,
      help: "JSONata over the flow context; must evaluate to a choice label or a list of labels — e.g. nodes.review.output.comment_count > 0 ? ['fix'] : ['ship']",
    },
    {
      key: "question", label: "Question (source=agent)", type: "text" as const,
      help: "{{vars}} allowed — the agent prompt is auto-built from this plus the choice descriptions",
    },
    {
      key: "choices", label: "Choices", type: "choices" as const,
      help: "The branch labels — outgoing edges must carry a label that matches one of these; descriptions steer an agent classifier",
    },
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

  /** The engine's choose action validates + records a manual branch pick. */
  applyChoice(node: NodeRow, flowId: string, chosen: string[], rationale?: string): void {
    this.validateChoice(chosen);
    this.support.setNode(node.id, {
      status: "approved",
      output: JSON.stringify({ chosen, rationale: rationale ?? "chosen by the user" }),
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

  async run(ctx: FlowCtx, rawInput: Record<string, unknown>, config: Record<string, unknown>): Promise<RunOutcome> {
    const cfg = this.runConfig(config);
    const node = this.node(ctx);
    // inline paths (manual / expression) — set running, then finish through
    // the shared outcome path (status + output + event) like execute() does
    this.support.setNode(node.id, { status: "running", input: JSON.stringify(rawInput ?? {}) });

    if (cfg.source === "manual") {
      // nothing to compute — hold and let the decision card collect the pick
      return this.applyOutcome(ctx, this.awaiting("pick a branch in the decision card"));
    }

    if (cfg.source === "expression") {
      if (!cfg.expression?.trim()) {
        throw new Error(`${this.label}: no condition expression configured — set one in the template editor`);
      }
      const r = await evalJsonata(cfg.expression, buildFlowContext(ctx));
      if (!r.ok) throw new Error(`${this.label}: the condition failed — ${r.error}`);
      const chosen = this.normalizeChosen(r.value);
      if (!chosen.length) {
        throw new Error(
          `${this.label}: the condition selected no branch — return a valid choice label (${this.choiceLabels(cfg).join(", ")})`);
      }
      return this.applyOutcome(ctx, this.applyPick(ctx, chosen, `expression match: ${JSON.stringify(r.value)}`));
    }

    // agent classification — constrained structured output, plan mode (read-only).
    // The inherited run input is question-addressable: {{input.<field>}} refs
    // the previous node's output (the node declares no input contract).
    const inherited = { ...(rawInput ?? {}) };
    delete inherited.source;
    return this.execute(ctx, {
      input: { ...rawInput, source: "agent" },
      prompt: this.buildAgentPrompt(cfg, { ...buildFlowContext(ctx), input: inherited }),
      promptOverride: null,
      agent: {
        mode: "plan",
        name: `${this.label} ${ctx.ticket.key}`,
        model: null, // a decision is a judgment call — it uses the flow/default model
        startingRef: ctx.flow.mr_branch ?? undefined,
      },
      label: `${this.label.toLowerCase()} decision`,
      finalize: async (runResult) => {
        const parsed = this.parseAgentChoice(cfg, runResult.result ?? "");
        return this.applyPick(ctx, [parsed.choice], parsed.rationale);
      },
    });
  }

  /** Restart recovery: re-apply the same result through the same contract. */
  override async recover(ctx: FlowCtx, node: NodeRow, result: CursorRunResult, note: string): Promise<boolean> {
    if (result.status !== "finished") return false; // fail it — decision runs are re-runnable
    const cfg = this.runConfig(this.nodeConfig(ctx));
    let outcome: RunOutcome;
    if (cfg.source === "agent") {
      const parsed = this.parseAgentChoice(cfg, result.result ?? "");
      outcome = this.applyPick(ctx, [parsed.choice], parsed.rationale);
    } else if (cfg.source === "manual") {
      outcome = this.awaiting("pick a branch in the decision card");
    } else {
      return false; // expression decisions run inline — nothing to recover from
    }
    const output = this.outputSchema.parse(outcome.output);
    this.support.setNode(node.id, {
      status: outcome.status,
      output: JSON.stringify(output),
    });
    db.emitEvent(ctx.flow.id, node.id, "lifecycle", `${outcome.event} (${note})`);
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
  private applyPick(ctx: FlowCtx, chosen: string[], rationale: string): RunOutcome {
    const hold = this.holdsForApproval(ctx);
    return {
      status: hold ? "awaiting_approval" : "done",
      output: { chosen, rationale },
      event: `${this.label} chose ${chosen.join(" + ")}${hold ? " — awaiting confirmation" : ""}`,
      eventData: { chosen, rationale },
      reply: `**${chosen.join(" + ")}**${rationale ? ` — ${rationale}` : ""}`,
    };
  }

  /** The manual-source hold state: no pick until the user chooses. */
  private awaiting(rationale: string): RunOutcome {
    return {
      status: "awaiting_approval",
      output: { chosen: [], rationale },
      event: `${this.label} is waiting for a branch choice`,
      eventData: { choices: this.choiceLabels() },
      reply: rationale,
    };
  }

  /**
   * Build the agent decision prompt: the user's question + per-choice
   * descriptions (how the user steers the classifier) + the flow-state JSON +
   * the strict response contract. `{{vars}}` in the question render via the
   * agent node's variable interpolation.
   */
  private buildAgentPrompt(cfg: DecisionDef, vars: Record<string, unknown>): string {
    const choices = cfg.choices.map((c) => `- ${c.label}: ${c.description ?? ""}`.trim()).join("\n");
    const question = renderAgentPrompt(cfg.question || "Choose the next step for this flow.", vars);
    return [
      question,
      "",
      "Flow state (JSON):",
      JSON.stringify(vars, null, 2),
      "",
      "Choose the next step. Options:",
      choices,
      "",
      'Respond ONLY with a JSON object: {"choice": "<one of the labels above>", "rationale": "<1-2 sentences>"}.',
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
