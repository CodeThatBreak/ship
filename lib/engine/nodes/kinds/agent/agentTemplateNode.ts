import "server-only";

import { z } from "zod";
import type { NodeRow } from "../../../../db/rows";
import type { AgentRunResult } from "../../../ports/agentPort";
import type { RecoveryResult } from "../../shared/types/recovery";
import type { AgentRunner } from "../../../harness/harnessExports";
import { AGENT_OUTPUT_FORMAT } from "../../../constants/declarative";
import type { FlowContextHelper, NodeSupport } from "../../shared/nodeSharedExports";
import {
  type FlowCtx,
  type NodeCapabilities,
  type RunOutcome,
} from "../../shared/nodeSharedExports";
import { DeclarativeAgentNode } from "../../shared/declarativeNode";
import { parseConfigSnapshot } from "../../../templates/nodeConfig";
import { AgentOutputPipeline } from "../../shared/agentOutput/agentOutputPipeline";
import { retryFeedbackBody } from "../../shared/agentOutput/utils/retryFeedback";
import { AgentDefSchema, type AgentDef } from "../../schemas/declarativeSchemas";
import type { RenderedBlock } from "../../../prompts/promptLibrary/types/promptLibrary";
import { nodeRoles, type NodePromptPreview, type PromptPreviewParams } from "../../shared/nodeSharedExports";
import type { SplitUnit } from "../../shared/nodeSharedExports";
import { splitDirective } from "./splitDirective";
import { resolveStartingRef } from "./baseRefResolver";
import { retryBudgetOf } from "./retryBudget";
import { AGENT_CONFIG_FIELDS } from "./constants/agentConstantsExports";
import { AGENT_START_LABEL } from "./constants/startLabel";
import { AgentRunInput, agentOutputContract } from "./schema";
import {
  agentContractDirective,
  composeAgentPrompt,
  renderAgentFeedback,
  renderAgentPrompt,
  resolveAgentModel,
} from "./agentPrompt";
import { agentSplitUnits } from "./agentSplitUnits";
import { shapeAgentOutcome } from "./agentOutcome";

export type { AgentDef };

/**
 * The runtime class behind every `node_templates` row with kind='agent'
 * (§4.2): one instance per (row, instance key). The prompt node declares
 * inputs/outputs statically (they show in the configurator), renders
 * PromptLibrary-style variables, and reuses the standard agent run lifecycle —
 * status, streaming, cost, artifacts, output validation. No new infrastructure.
 *
 * This is the kind's thin orchestrator (§3.11): it wires the lifecycle
 * (run / chat / recover / previewPrompt / splitUnits) onto the shared
 * `AgentRunNode` tier and delegates the mechanics — prompt assembly to
 * `agentPrompt.ts` (the ONE prompt path run/chat/preview share, so the
 * preview cannot drift) and split-unit mapping to `agentSplitUnits.ts`.
 * Invariants upheld: every agent response is published only through the
 * output contract (`applyOutput` — never an unvalidated pass-through), and
 * every prompt surface rides the same contract directives (composeAgentPrompt).
 * Must never start an agent outside `execute()`'s lifecycle, never persist
 * node/artifact rows outside `applyOutcome`, and never publish a json output
 * that skipped schema validation.
 */
export class AgentTemplateNode extends DeclarativeAgentNode<AgentDef, Record<string, unknown>, Record<string, unknown>> {
  readonly promptKeys = [] as const;
  readonly order = 1000;
  override readonly retryable = true;

  /** Chat is the node's entry point: the first turn (before any output) runs the
   * rendered prompt body; later turns refine. The prompt-node key is the
   * per-instance key so the composer preview targets this node's own config. */
  override readonly capabilities: NodeCapabilities;

  readonly inputSchema: z.ZodType<Record<string, unknown>>;
  readonly outputSchema: z.ZodType<Record<string, unknown>>;

  /** the ONE agent-output path for this kind's json responses (step 05) */
  private readonly outputPipeline: AgentOutputPipeline;

  /** no declared input contract — the input is the previous node's output */
  override readonly inheritsParentInput = true;

  /** the parsed declarative definition (= the class-layer config) */
  declare readonly def: AgentDef;

  constructor(
    tmpl: {
      id: string;
      name: string;
      description: string | null;
      config: unknown;
    },
    instanceKey?: string,
    services: {
      support?: NodeSupport;
      runner?: AgentRunner;
      ctxHelper?: FlowContextHelper;
    } = {}
  ) {
    const def = AgentDefSchema.parse(tmpl.config ?? {});
    super(tmpl, instanceKey, def, "agent", services);
    this.capabilities = { refinable: true, promptNode: this.key, startLabel: AGENT_START_LABEL };
    this.inputSchema = AgentRunInput;
    this.outputPipeline = new AgentOutputPipeline(this.support);
    // the real output contract (step 04): the declarative def cache holds
    // instances, so the JSON-Schema → Zod conversion happens once per instance
    this.outputSchema = agentOutputContract(this.def, this.label);
  }

  /**
   * The addressable output fields for the configurator's Contract tab: a
   * json-output agent publishes its declared output schema; markdown is the
   * default artifact contract.
   */
  override outputContract(def: Record<string, unknown> = this.def): unknown {
    if (def.output === AGENT_OUTPUT_FORMAT.JSON && def.output_schema) return def.output_schema;

    return {
      type: 'object',
      properties: {
        [AGENT_OUTPUT_FORMAT.MARKDOWN]: {
          type: 'string',
          description: 'Agent output, saved as an artifact',
        },
      },
      required: [AGENT_OUTPUT_FORMAT.MARKDOWN],
    };
  }

  /**
   * The full authoring form (see `./constants/index.ts`): one entry per knob,
   * assembled in the drawer's order — the prompt is edited in place, after
   * the node is connected, so the upstream run-context variables are
   * clickable chips.
   */
  override readonly configFields = AGENT_CONFIG_FIELDS;

  /**
   * Live prompt preview (step 05): the composed prompt a fresh run would
   * send, built through the SAME `getPrompt`/`composePrompt` path `run()`
   * uses so the preview is byte-identical to the run bytes — the config
   * prompt rendered against the flow vars, plus the contract/split
   * directives as the display blocks. The recorded run input is not
   * consulted here (the modal's last-run overlay shows that separately).
   * Returns null when no prompt is configured — nothing would be sent.
   */
  async previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): Promise<NodePromptPreview | null> {
    void params;
    const config = await nodeRoles.previewConfig(this, node);
    const cfg = this.runConfig(config);
    if (!(typeof cfg.prompt === "string" && cfg.prompt.trim())) return null;
    const { body } = await renderAgentPrompt(ctx, {}, cfg, this.label);
    const blocks: RenderedBlock[] = [];
    if (cfg.output === AGENT_OUTPUT_FORMAT.JSON) {
      // the same directive bytes composeAgentPrompt appends at run time
      blocks.push({
        kind: "contract",
        text: agentContractDirective(cfg, this.outputSchema),
      });
    }
    if (cfg.split) {
      blocks.push({ kind: "rules", text: splitDirective(cfg.split) });
    }
    return {
      templateKey: this.declarativeKind,
      configBody: cfg.prompt,
      assembly: { body, blocks, final: composeAgentPrompt(body, cfg, this.outputSchema) },
    };
  }

  /**
   * The split source port (agent-node split plan §2.1, Phase 3): the node
   * reads its own recorded output and answers "here are my units" — the
   * mapping itself lives in `agentSplitUnits.ts`. The items are
   * schema-validated data by construction (`applyOutput` already enforced the
   * output contract) — NO second validation pass. The node never spawns
   * anything; it only answers "here are my units". A malformed array is a
   * producer error — loud, like a contract failure (see agentSplitUnits).
   */
  override async splitUnits(ctx: FlowCtx): Promise<SplitUnit[] | null> {
    const cfg = this.runConfig(await this.nodeConfig(ctx));
    const split = cfg.split;
    if (!split) return null;

    // nodeByKey returns the RAW row (db.get does not map): the `output`
    // column is the JSON TEXT blob here, not the decoded shape — parse it
    // before reading the split field (parseConfigSnapshot yields {} for a
    // missing/unreadable blob → no array → null, no expansion; an
    // already-decoded record is tolerated too)
    const rawOutput: unknown = (await this.node(ctx)).output;
    const output = parseConfigSnapshot(
      typeof rawOutput === "string" || rawOutput == null ? rawOutput : JSON.stringify(rawOutput),
    );
    return agentSplitUnits(split, output, this.label);
  }

  /**
   * Run the agent: render the prompt against flow variables, execute through
   * the shared run lifecycle, then validate/shape the output contract.
   *
   * Contract:
   * - **Prompt resolution** — the run input's `prompt` (chat-modal re-run)
   *   wins over the template config's `prompt`; at least one must be present.
   * - **Input inheritance** — the node declares no input contract, so
   *   `rawInput` is the previous node's output. It is exposed to the template
   *   as `{{input.<field>}}`, minus the engine-owned `prompt`/`model` keys.
   * - **Model resolution** — input `model` overrides config, and either may
   *   be a `{{...}}` ref, rendered against the flow context at run time.
   * - **Output contract** — `output: json` rides the standard contract
   *   directive and is schema-validated in `applyOutput`; a missing or
   *   schema-violating response gets ONE bounded feedback retry on the same
   *   agent session before the node fails loudly. `output: markdown`
   *   publishes `{{nodes.<key>.output.markdown}}` and saves the text as an
   *   artifact. Approval-triggered instances hold at `awaiting_approval`
   *   instead of `done`.
   * - **Recorded input** — the run record persists the RENDERED final prompt
   *   plus its `prompt_source` (modal | config | default), not the raw template.
   *
   * @param ctx - Flow execution context (task, flow, mr_branch, run services).
   * @param rawInput - The inherited run input; may carry a `prompt` override
   *   and a `model` override (plain string or `{{...}}` ref).
   * @param config - The engine-merged node config, parsed as an `AgentDef`;
   *   falls back to the constructor-parsed `this.def` if it does not parse.
   * @returns The lifecycle outcome from `execute`: `done` or
   *   `awaiting_approval`, with the contract-shaped output, artifact and reply.
   * @throws If neither input nor config supplies a non-empty prompt, or when
   *   the response still misses the output contract after the one feedback
   *   retry (no JSON, schema mismatch, or the agent's self-reported error
   *   envelope — the envelope never retries).
   */
  async run(ctx: FlowCtx, rawInput: Record<string, unknown>, config: Record<string, unknown>): Promise<RunOutcome> {
    const cfg = this.runConfig(config);

    const model = await resolveAgentModel(ctx, rawInput, cfg);
    const { body, source } = await renderAgentPrompt(ctx, rawInput, cfg, this.label);
    const prompt = composeAgentPrompt(body, cfg, this.outputSchema);

    const input: Record<string, unknown> = {
      ...rawInput,
      prompt: prompt,
      prompt_source: source,
      model,
    };

    return this.execute(ctx, {
      input,
      prompt: prompt,
      agent: {
        mode: cfg.mode,
        name: `${this.label} ${ctx.task.key}`,
        model,
        startingRef: await resolveStartingRef(ctx, cfg),
        settingSources: cfg.mcp_sources,
      },
      label: this.label.toLowerCase(),
      finalize: async result => this.finalizeOutput(ctx, result, cfg, model),
    });
  }

  /** Chat refinement: a follow-up run on the node's agent. The rendered
   * feedback rides the same contract directives a fresh run's prompt does —
   * the follow-up output goes through the same applyOutput validation. */
  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    if (this.isFirstTurn(await this.node(ctx))) {
      const outcome = await this.run(
        ctx,
        { prompt: content, model: model ?? null },
        await this.nodeConfig(ctx),
      );
      return outcome.reply;
    }
    const cfg = this.runConfig(await this.nodeConfig(ctx));
    const node = await this.node(ctx);

    const prompt = composeAgentPrompt(
      await renderAgentFeedback(ctx, content),
      cfg,
      this.outputSchema,
    );

    const priorInput =
      node.input != null && typeof node.input === "object" && !Array.isArray(node.input)
        ? (node.input as Record<string, unknown>)
        : {};

    return this.execute(ctx, {
      input: { ...priorInput, model: model ?? null, feedback: content },
      prompt,
      agent: {
        mode: cfg.mode,
        name: `${this.label} ${ctx.task.key}`,
        model: model ?? cfg.model ?? null,
        startingRef: await resolveStartingRef(ctx, cfg),
        followUpOn: await this.support.lastAgentId(node.id),
        settingSources: cfg.mcp_sources,
      },
      label: `${this.label.toLowerCase()} follow-up`,
      finalize: async result => this.finalizeOutput(ctx, result, cfg, model ?? cfg.model ?? null),
    }).then(o => o.reply);
  }

  /** Restart recovery: re-apply the same output contract through the shared
   * persistence path (applyOutcome) — a recovered finish persists the same
   * node/artifact rows as a normal finish, with the note on the event. A
   * contract-violating recorded result is `manual` with the violation as the
   * reason (never a throw — the fixed recovery ABI). */
  async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<RecoveryResult> {
    if (result.status !== 'finished') {
      return { kind: 'manual', reason: `the agent run ended with ${result.status}` };
    }
    try {
      const outcome = await this.applyOutput(ctx, result.result ?? '', this.runConfig(await this.nodeConfig(ctx)));
      await this.applyOutcome(ctx, outcome, { note });
      return { kind: 'recovered' };
    } catch (e: unknown) {
      return { kind: 'manual', reason: `re-applying the recorded output failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * The output-contract path both run() and chat() finalize through: markdown
   * output is validated directly (an empty response is a typed failure —
   * never a fabricated empty-response placeholder); json output rides the ONE
   * agent-output pipeline (step 05) — the contract with its bounded feedback
   * retry (`retryBudget`), typed events on every outcome.
   */
  private async finalizeOutput(
    ctx: FlowCtx,
    result: AgentRunResult,
    cfg: AgentDef,
    model: string | null
  ): Promise<RunOutcome> {
    if (cfg.output !== AGENT_OUTPUT_FORMAT.JSON) {
      return this.applyOutput(ctx, result.result ?? '', cfg);
    }
    const node = await this.node(ctx);
    return this.outputPipeline.run<RunOutcome>({
      ctx,
      nodeId: node.id,
      label: this.label,
      text: result.result ?? '',
      budget: retryBudgetOf(cfg, this.retryBudget),
      validate: (t) => this.applyOutput(ctx, t, cfg),
      // the retry prompt re-states the full contract (one JSON object, the
      // schema, the error-envelope escape hatch) on top of the shared feedback
      retryPrompt: (failure) => composeAgentPrompt(retryFeedbackBody(failure), cfg, this.outputSchema),
      executeRetry: async (prompt) => {
        const { result: retry } = await this.runner.executeRun(
          ctx,
          node.id,
          async () =>
            this.runner.startAgent(ctx, {
              prompt,
              mode: cfg.mode,
              name: `${this.label} ${ctx.task.key}`,
              model,
              // E2 fix: the feedback retry starts from the SAME ref the first
              // run did — the one resolver, not a dropped knob
              startingRef: await resolveStartingRef(ctx, cfg),
              followUpOn: await this.support.lastAgentId(node.id),
              settingSources: cfg.mcp_sources,
            }),
          `${this.label.toLowerCase()} retry`
        );
        return retry.result ?? '';
      },
    });
  }

  /**
   * The output-contract path both run() and chat() finalize through (and
   * `recover` re-applies): the shaping itself lives in `agentOutcome.ts` —
   * markdown output is validated directly (an empty response is a typed
   * failure — never a fabricated empty-response placeholder); json output
   * rides the ONE agent-output pipeline (step 05) via `finalizeOutput`.
   * The approval hold is computed per attempt from the flow graph.
   */
  private async applyOutput(ctx: FlowCtx, text: string, cfg: AgentDef): Promise<RunOutcome> {
    return shapeAgentOutcome(text, cfg, this.outputSchema, this.label, await this.holdsForApproval(ctx));
  }
}

import { declarativeKindRegistry } from "../../declarativeRegistry";
import type { NodeDefinition } from "../../shared/nodeDefinition";

declarativeKindRegistry.register("agent", AgentDefSchema, (row, inst) =>
  new AgentTemplateNode(row, inst) as NodeDefinition<unknown, Record<string, unknown>>);
