import { z } from 'zod';
import type { NodeRow } from '../../../../db/rows';
import type { AgentRunResult } from '../../../ports/agent-port';
import type { AgentRunner } from '../../../harness';
import { NODE_RUN_STATUS } from '../../../../../constants/flow';
import { AGENT_OUTPUT_FORMAT } from '../../../constants/declarative';
import { NODE_TRIGGER_TYPE } from '../../../constants/triggers';
import type { FlowContextHelper, NodeSupport } from '../../shared';
import {
  AgentRunNode,
  PROMPT_SOURCE,
  TemplateRenderer,
  type FlowCtx,
  type NodeCapabilities,
  type PromptSource,
  type RunOutcome,
} from '../../shared';
import { templateStore } from '../../../templates/template-store';
import { extractJson, jsonSchemaIssues } from './json-schema-lite';
import { AGENT_OUTPUT_ERROR, AgentOutputError } from '../../shared/agent/output-error';
import { AgentDefSchema, type AgentDef } from '../../declarative-schemas';
import { AGENT_CONFIG_FIELDS } from './constants';

export type { AgentDef };

/**
 * The runtime class behind every `node_templates` row with kind='agent'
 * (§4.2): one instance per (row, instance key). The prompt node declares
 * inputs/outputs statically (they show in the configurator), renders
 * PromptLibrary-style variables, and reuses the standard agent run lifecycle —
 * status, streaming, cost, artifacts, output validation. No new infrastructure.
 */
export class AgentTemplateNode extends AgentRunNode<Record<string, unknown>, Record<string, unknown>> {
  readonly key: string;
  readonly label: string;
  readonly promptKeys = [] as const;
  readonly order = 1000;
  readonly retryable = true;

  /** §T4: chat messages re-run the agent with the rendered feedback. */
  override readonly capabilities: NodeCapabilities = { refinable: true };

  readonly inputSchema: z.ZodType<Record<string, unknown>>;
  readonly outputSchema: z.ZodType<Record<string, unknown>>;

  /** no declared input contract — the input is the previous node's output */
  override readonly inheritsParentInput = true;

  /** the parsed declarative definition (= the class-layer config) */
  readonly def: AgentDef;

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
    super(services.support, services.runner, services.ctxHelper);
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
      this.def.output === AGENT_OUTPUT_FORMAT.JSON
        ? z.looseObject({})
        : z.looseObject({ [AGENT_OUTPUT_FORMAT.MARKDOWN]: z.string() })
    ) as z.ZodType<Record<string, unknown>>;

    this.description = tmpl.description ?? undefined;
  }

  /**
   * The addressable output fields for the configurator's Contract tab: a
   * json-output agent publishes its declared output schema; markdown is the
   * default artifact contract.
   */
  override outputContract(def: Record<string, unknown> = this.def): unknown {
    if (def.output === AGENT_OUTPUT_FORMAT.JSON && def.output_schema) {
      return def.output_schema;
    }

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
  readonly configFields = AGENT_CONFIG_FIELDS;

  /** Display description from the node catalog entry. */
  description?: string;

  /** Class-layer config = the declarative definition itself. */
  override defaultConfig(): Record<string, unknown> {
    return this.def as unknown as Record<string, unknown>;
  }

  private getPrompt(
    ctx: FlowCtx,
    rawInput: Record<string, unknown>,
    config: Record<string, unknown>
  ): { prompt: string; source: PromptSource } {
    const cfg = this.runConfig(config);
    const { prompt: inputPrompt, model: _, ...inheritedInput } = rawInput;

    const promptBody = typeof inputPrompt === 'string' ? inputPrompt.trim() : '';
    const template = promptBody || cfg.prompt;

    if (!template.trim()) {
      throw new Error(`${this.label}: no prompt configured — set one in the template editor`);
    }
    // The inherited run input is prompt-addressable: {{input.<field>}} refs the
    // previous node's output fields directly (the node inherits the parent's
    // contract); the engine-owned prompt/model keys are stripped from it.

    // json output rides the standard contract directive: the schema the
    // response must satisfy and the agent's error-envelope escape hatch (it
    // self-reports when it cannot comply — applyOutput recognizes the envelope)
    const promptWithoutContract = TemplateRenderer.render(template, {
      ...TemplateRenderer.vars(ctx),
      input: inheritedInput,
    });

    // the run record's input.prompt is the RENDERED final prompt — the exact
    // text the agent receives (nodes.config.prompt stays the un-rendered source
    // of truth) — plus where it came from, so the modal can annotate lastRun
    const source: PromptSource = promptBody
      ? PROMPT_SOURCE.MODAL
      : cfg.prompt
        ? PROMPT_SOURCE.CONFIG
        : PROMPT_SOURCE.DEFAULT;

    const prompt =
      cfg.output === AGENT_OUTPUT_FORMAT.JSON
        ? TemplateRenderer.compose(promptWithoutContract)
            .addBlankLine()
            .addBlankLine()
            .addLine(AgentOutputError.directive(cfg.output_schema))
            .build()
        : promptWithoutContract;

    return { prompt, source };
  }

  private getModel(ctx: FlowCtx, rawInput: Record<string, unknown>, config: Record<string, unknown>): string | null {
    const cfg = this.runConfig(config);

    const { model: inputModel } = rawInput;

    const runModel = typeof inputModel === 'string' && inputModel.trim() ? inputModel.trim() : null;
    // the model override may itself be a {{...}} ref (an upstream node that
    // picks the model) — rendered against the flow context at run time
    const modelTemplate = runModel ?? cfg.model ?? null;
    return modelTemplate ? TemplateRenderer.render(modelTemplate, TemplateRenderer.vars(ctx)).trim() : null;
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
   *   directive and is schema-validated in `applyOutput` (bad responses fail
   *   the node loudly); `output: markdown` publishes `{{nodes.<key>.output.markdown}}`
   *   and saves the text as an artifact. Approval-triggered instances hold at
   *   `awaiting_approval` instead of `done`.
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
   *   `applyOutput` rejects the agent's response (no JSON, schema mismatch, or
   *   the agent's self-reported error envelope).
   */
  async run(ctx: FlowCtx, rawInput: Record<string, unknown>, config: Record<string, unknown>): Promise<RunOutcome> {
    const cfg = this.runConfig(config);

    const model = this.getModel(ctx, cfg, rawInput);
    const { prompt, source } = this.getPrompt(ctx, cfg, rawInput);

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
        startingRef: ctx.flow.mr_branch ?? undefined,
        settingSources: cfg.mcp_sources,
      },
      label: this.label.toLowerCase(),
      finalize: async result => this.applyOutput(ctx, result.result ?? '', cfg),
    });
  }

  /** Chat refinement: a follow-up run on the node's agent. The rendered
   * feedback rides the same contract directive a fresh run's prompt does —
   * the follow-up output goes through the same applyOutput validation. */
  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    const cfg = this.runConfig(this.nodeConfig(ctx));

    const promptWithoutContract = TemplateRenderer.render(content, TemplateRenderer.vars(ctx));

    const prompt =
      cfg.output === AGENT_OUTPUT_FORMAT.JSON
        ? TemplateRenderer.compose(promptWithoutContract)
            .addBlankLine()
            .addBlankLine()
            .addLine(AgentOutputError.directive(cfg.output_schema))
            .build()
        : promptWithoutContract;

    return this.execute(ctx, {
      input: { model: model ?? null, feedback: content },
      prompt,
      agent: {
        mode: cfg.mode,
        name: `${this.label} ${ctx.task.key}`,
        model: model ?? cfg.model ?? null,
        startingRef: ctx.flow.mr_branch ?? undefined,
        followUpOn: this.support.lastAgentId(this.node(ctx).id),
        settingSources: cfg.mcp_sources,
      },
      label: `${this.label.toLowerCase()} follow-up`,
      finalize: async result => this.applyOutput(ctx, result.result ?? '', cfg),
    }).then(o => o.reply);
  }

  /** Restart recovery: re-apply the same output contract through the shared
   * persistence path (applyOutcome) — a recovered finish persists the same
   * node/artifact rows as a normal finish, with the note on the event. */
  async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<boolean> {
    if (result.status !== 'finished') return false;
    const outcome = this.applyOutput(ctx, result.result ?? '', this.runConfig(this.nodeConfig(ctx)));
    this.applyOutcome(ctx, outcome, { note });
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
   * bad response — with the standard {@link AgentOutputError} payload: the
   * machine-readable code, every schema violation (path + message), and the
   * head of the raw response so the trail shows what actually came back.
   * The agent may also self-report that it cannot comply by answering with
   * the standard error envelope — its reason then is the failure message,
   * verbatim. `output: markdown` saves the text as an artifact and publishes
   * `{{nodes.<key>.output.markdown}}`.
   */
  private applyOutput(ctx: FlowCtx, text: string, cfg: AgentDef): RunOutcome {
    const hold = this.holdsForApproval(ctx);
    if (cfg.output === AGENT_OUTPUT_FORMAT.JSON) {
      const parsed = extractJson(text);

      if (parsed == null) {
        throw new AgentOutputError({
          code: AGENT_OUTPUT_ERROR.NO_JSON,
          label: this.label,
          message: `${this.label}: the agent response contained no JSON — the node's output format is configured as json`,
          issues: [],
          response: text,
        });
      }
      // the agent's escape hatch: it answered with the standard error
      // envelope instead of contract-conforming output — convey its reason
      const reported = AgentOutputError.reported(parsed);
      if (reported != null) {
        throw new AgentOutputError({
          code: AGENT_OUTPUT_ERROR.AGENT_REPORTED,
          label: this.label,
          // the agent's reason is the headline — its words, conveyed to the user
          message: `${this.label}: ${reported.reason}`,
          issues: [],
          reported,
          response: text,
        });
      }
      const issues = jsonSchemaIssues(cfg.output_schema, parsed, this.label);
      if (issues.length) {
        throw new AgentOutputError({
          code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
          label: this.label,
          // the first violation stays the headline text — the same human message
          // a bare `validateJsonSchema` throw produced, unchanged for existing UI
          message: issues[0]?.message ?? `${this.label}: the agent response violated its output schema`,
          issues,
          response: text,
        });
      }
      const output = parsed as Record<string, unknown>;
      return {
        status: hold ? NODE_RUN_STATUS.AWAITING_APPROVAL : NODE_RUN_STATUS.DONE,
        output,
        artifact: {
          kind: AGENT_OUTPUT_FORMAT.JSON,
          content: JSON.stringify(output, null, 2),
        },
        event: `${this.label} output ready${hold ? ' — awaiting approval' : ''}`,
        eventData: { output_format: AGENT_OUTPUT_FORMAT.JSON },
        reply: '```json\n' + JSON.stringify(output, null, 2) + '\n```',
      };
    }
    const body = text.trim() || '(empty response)';
    return {
      status: hold ? NODE_RUN_STATUS.AWAITING_APPROVAL : NODE_RUN_STATUS.DONE,
      output: { [AGENT_OUTPUT_FORMAT.MARKDOWN]: body },
      artifact: { kind: AGENT_OUTPUT_FORMAT.MARKDOWN, content: body },
      event: `${this.label} output ready${hold ? ' — awaiting approval' : ''}`,
      eventData: { output_format: AGENT_OUTPUT_FORMAT.MARKDOWN },
      reply: body,
    };
  }

  /**
   * Approval-triggered node instances hold at `awaiting_approval` after a
   * successful run; outgoing edges activate on the generic approve action.
   * The trigger type lives on the template instance (looked up by node_key).
   */
  private holdsForApproval(ctx: FlowCtx): boolean {
    const graph = templateStore.graphForFlow(ctx.flow.id);
    if (!graph) return false;

    const spec = graph.byKey.get(this.key);
    return spec?.trigger.type === NODE_TRIGGER_TYPE.APPROVAL;
  }
}
