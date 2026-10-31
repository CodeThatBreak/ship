import "server-only";

import { z } from 'zod';
import type { NodeRow } from '../../../../db/rows';
import type { AgentRunResult } from '../../../ports/agent-port';
import type { AgentRunner } from '../../../harness';
import { NODE_RUN_STATUS } from '../../../../../constants/flow';
import { AGENT_OUTPUT_FORMAT } from '../../../constants/declarative';
import type { FlowContextHelper, NodeSupport } from '../../shared';
import {
  PROMPT_SOURCE,
  TemplateRenderer,
  type FlowCtx,
  type NodeCapabilities,
  type PromptSource,
  type RunOutcome,
} from '../../shared';
import { DeclarativeAgentNode } from "../../shared/declarative-node";
import { parseConfigSnapshot } from '../../../templates/node-config';
import { extractJson, jsonSchemaIssues } from './json-schema-lite';
import { AGENT_OUTPUT_ERROR, AgentOutputError, type AgentOutputErrorCode } from '../../shared/agent/output-error';
import { AgentDefSchema, type AgentDef } from '../../declarative-schemas';
import type { SplitUnit } from '../../shared';
import { splitDirective } from './split-directive';
import { AGENT_CONFIG_FIELDS } from './constants';

export type { AgentDef };

/** Output-contract failures a feedback turn can fix: missing or schema-
 *  violating JSON. `agent_reported` never retries — the agent explicitly said
 *  it cannot comply, and its reason goes to the user (chat refinement), not
 *  back to the agent. */
const RETRYABLE_OUTPUT_ERRORS: ReadonlySet<AgentOutputErrorCode> = new Set([
  AGENT_OUTPUT_ERROR.NO_JSON,
  AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
]);

/**
 * The runtime class behind every `node_templates` row with kind='agent'
 * (§4.2): one instance per (row, instance key). The prompt node declares
 * inputs/outputs statically (they show in the configurator), renders
 * PromptLibrary-style variables, and reuses the standard agent run lifecycle —
 * status, streaming, cost, artifacts, output validation. No new infrastructure.
 */
export class AgentTemplateNode extends DeclarativeAgentNode<AgentDef, Record<string, unknown>, Record<string, unknown>> {
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

  /**
   * The split source port (agent-node split plan §2.1, Phase 3): map the
   * validated output's array at `split.field` into units. The items are
   * schema-validated data by construction (`applyOutput` already enforced the
   * output contract) — NO second validation pass. The node never spawns
   * anything; it only answers "here are my units".
   *
   * - No `split` declared, no run output yet, no array at `split.field`, or an
   *   empty array → null (the node is not a source for this run — no expansion).
   * - Mapping: `key` ← `item[key_field]`; `title` ← the item's string `title`
   *   field when present, else the key (deliberately simple and deterministic —
   *   no fallback chain, §2.9); `dependsOn` ← `item[depends_on_field]`
   *   (default []); `target` ← the split default, overridden per item by
   *   `item[target_field]` when set; `item` rides verbatim.
   * - A malformed array (non-array at the field, non-object item, missing or
   *   non-string key, non-string[] dependencies) is a producer error — loud,
   *   like a contract failure: the same {@link AgentOutputError} payload
   *   applyOutput throws (code `schema_mismatch`), since these shapes all
   *   violate the unit contract the split directive declared.
   */
  override splitUnits(ctx: FlowCtx): SplitUnit[] | null {
    const cfg = this.runConfig(this.nodeConfig(ctx));
    const split = cfg.split;
    if (!split) return null;

    // nodeByKey returns the RAW row (db.get does not map): the `output`
    // column is the JSON TEXT blob here, not the decoded shape — parse it
    // before reading the split field (parseConfigSnapshot yields {} for a
    // missing/unreadable blob → no array → null, no expansion; an
    // already-decoded record is tolerated too)
    const rawOutput: unknown = this.node(ctx).output;
    const output = parseConfigSnapshot(
      typeof rawOutput === "string" || rawOutput == null ? rawOutput : JSON.stringify(rawOutput),
    );
    const raw = output[split.field];
    if (raw == null) return null;
    if (!Array.isArray(raw)) {
      throw this.splitUnitsError(
        `split field "${split.field}" must be an array of unit items (got ${typeof raw})`,
        raw,
      );
    }
    if (!raw.length) return null;
    return raw.map((item, index) => this.unitOf(split, item, index));
  }

  /** One validated output item → a SplitUnit (see splitUnits for the rules). */
  private unitOf(split: NonNullable<AgentDef["split"]>, item: unknown, index: number): SplitUnit {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      throw this.splitUnitsError(
        `split field "${split.field}" item ${index} is not an object`,
        item,
      );
    }
    const record = item as Record<string, unknown>;
    const key = record[split.key_field];
    if (typeof key !== "string" || !key.trim()) {
      throw this.splitUnitsError(
        `item ${index} has no usable "${split.key_field}" — every unit needs a stable, non-empty key`,
        item,
      );
    }
    const rawDeps = record[split.depends_on_field];
    const dependsOn: string[] = [];
    if (rawDeps != null) {
      if (!Array.isArray(rawDeps)) {
        throw this.splitUnitsError(
          `item ${index}'s "${split.depends_on_field}" must be an array of unit keys`,
          item,
        );
      }
      for (const dep of rawDeps) {
        if (typeof dep !== "string" || !dep.trim()) {
          throw this.splitUnitsError(
            `item ${index}'s "${split.depends_on_field}" must be an array of unit keys`,
            item,
          );
        }
        dependsOn.push(dep);
      }
    }
    const override = split.target_field != null ? record[split.target_field] : undefined;
    const target =
      typeof override === "string" && override.trim() ? override : split.target;
    return {
      key,
      // title: the item's string `title` when it declares one, else the key
      title: typeof record.title === "string" && record.title.trim() ? record.title : key,
      dependsOn,
      ...(target != null ? { target } : {}),
      item,
    };
  }

  /** The loud producer failure, shaped exactly like an output-contract miss
   *  (the engine serializes the standard payload into the trail). */
  private splitUnitsError(message: string, offending: unknown): AgentOutputError {
    return new AgentOutputError({
      code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
      label: this.label,
      message: `${this.label}: ${message}`,
      issues: [],
      response: JSON.stringify(offending ?? null),
    });
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

    return { prompt: this.composePrompt(promptWithoutContract, cfg), source };
  }

  /**
   * The prompt body + the contract directives, composed in ONE place so every
   * surface (fresh run, chat follow-up, the bounded retry) appends the same
   * blocks in the same order: the output-contract directive first (json
   * output), then the split directive when the def declares `split` — units
   * are contract-shaped output, so the two belong together. A body with
   * nothing to append comes back byte-identical (no compose round-trip).
   */
  private composePrompt(body: string, cfg: AgentDef): string {
    if (cfg.output !== AGENT_OUTPUT_FORMAT.JSON) return body;
    const composed = TemplateRenderer.compose(body)
      .addBlankLine()
      .addBlankLine()
      .addLine(AgentOutputError.directive(cfg.output_schema));
    if (cfg.split) {
      composed.addBlankLine().addBlankLine().addLine(splitDirective(cfg.split));
    }
    return composed.build();
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

    const model = this.getModel(ctx, rawInput, cfg);
    const { prompt, source } = this.getPrompt(ctx, rawInput, cfg);

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
      finalize: async result => this.applyOutputWithRetry(ctx, result, cfg, model),
    });
  }

  /** Chat refinement: a follow-up run on the node's agent. The rendered
   * feedback rides the same contract directives a fresh run's prompt does —
   * the follow-up output goes through the same applyOutput validation. */
  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    const cfg = this.runConfig(this.nodeConfig(ctx));
    const node = this.node(ctx);

    const prompt = this.composePrompt(
      TemplateRenderer.render(content, TemplateRenderer.vars(ctx)),
      cfg,
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
        startingRef: ctx.flow.mr_branch ?? undefined,
        followUpOn: this.support.lastAgentId(node.id),
        settingSources: cfg.mcp_sources,
      },
      label: `${this.label.toLowerCase()} follow-up`,
      finalize: async result => this.applyOutputWithRetry(ctx, result, cfg, model ?? cfg.model ?? null),
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

  /**
   * Apply the output contract with one bounded self-heal: when the response
   * misses the contract (`no_json` / `schema_mismatch`), re-prompt the SAME
   * agent once with the specific violations as feedback (the plan node's
   * validation-retry pattern) and re-apply the contract to the retry response.
   * `agent_reported` propagates immediately — the agent self-reported that it
   * cannot comply, so its reason goes to the user, not back to the agent. A
   * second miss throws {@link AgentOutputError} and fails the node loudly
   * (manual Retry).
   */
  private async applyOutputWithRetry(
    ctx: FlowCtx,
    result: AgentRunResult,
    cfg: AgentDef,
    model: string | null
  ): Promise<RunOutcome> {
    try {
      return this.applyOutput(ctx, result.result ?? '', cfg);
    } catch (e: unknown) {
      if (!(e instanceof AgentOutputError) || !RETRYABLE_OUTPUT_ERRORS.has(e.code)) throw e;
      return this.retryOutput(ctx, e, cfg, model);
    }
  }

  /** One feedback turn on the same agent session (`followUpOn` = the run the
   *  contract just failed), then re-apply the contract to its response. */
  private async retryOutput(
    ctx: FlowCtx,
    failure: AgentOutputError,
    cfg: AgentDef,
    model: string | null
  ): Promise<RunOutcome> {
    const node = this.node(ctx);
    // the specific failure is the feedback: what the agent got wrong, in its
    // own response's terms — the same human messages the trail shows

    const feedbackTemplate =
      failure.code === AGENT_OUTPUT_ERROR.NO_JSON
        ? TemplateRenderer.compose('Your previous response could not be used: no JSON object could be parsed from it.')
            .addBlankLine()
            .addLine('Re-emit your ENTIRE response as a single JSON object.')
        : TemplateRenderer.compose('Your previous response was valid JSON but violated the output contract:')
            .addBlankLine()
            .addLines(failure.detail.issues.map(i => `  - ${i.path ? `${i.path}: ` : ''}${i.message}`))
            .addBlankLine()
            .addLine('Re-emit the corrected JSON object.');

    this.support.emitLifecycle(
      ctx.flow.id,
      node.id,
      `${this.label} output contract failed — retrying with feedback (${failure.code})`
    );

    // the retry prompt re-states the full contract (one JSON object, the
    // schema, the error-envelope escape hatch) on top of the feedback
    const retryPrompt = this.composePrompt(feedbackTemplate.build(), cfg);

    const retry = await this.runner.executeRun(
      ctx,
      node.id,
      () =>
        this.runner.startAgent(ctx, {
          prompt: retryPrompt,
          mode: cfg.mode,
          name: `${this.label} ${ctx.task.key}`,
          model,
          followUpOn: this.support.lastAgentId(node.id),
          settingSources: cfg.mcp_sources,
        }),
      `${this.label.toLowerCase()} retry`
    );
    return this.applyOutput(ctx, retry.result.result ?? '', cfg);
  }

  /**
   * Shape the agent's text into the declared output contract. `output: json`
   * validates against the declared JSON Schema and fails loudly on a bad
   * response — with the standard {@link AgentOutputError} payload: the
   * machine-readable code, every schema violation (path + message), and the
   * head of the raw response so the trail shows what actually came back.
   * The agent may also self-report that it cannot comply by answering with
   * the standard error envelope — its reason then is the failure message,
   * verbatim. (`applyOutputWithRetry` wraps this with one feedback retry for
   * `no_json` / `schema_mismatch`; `recover` re-applies it as-is — recovery
   * is persistence-only, a bad recorded result fails for manual retry.)
   * `output: markdown` saves the text as an artifact and publishes
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
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AgentOutputError({
          code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
          label: this.label,
          message: `${this.label}: json output must be a JSON object (got ${Array.isArray(parsed) ? 'array' : typeof parsed})`,
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
      if (cfg.output_schema && typeof cfg.output_schema === 'object') {
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
}

import { declarativeKindRegistry } from "../../declarative-registry";
import type { NodeDefinition } from "../../shared/node-definition";

declarativeKindRegistry.register("agent", AgentDefSchema, (row, inst) =>
  new AgentTemplateNode(row, inst) as NodeDefinition<unknown, Record<string, unknown>>);
