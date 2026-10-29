import { z } from 'zod';
import type { AgentRunResult } from '../../../ports/agent-port';
import type { NodeRow } from '../../../../db/rows';
import { prompts, sectionsOf, type PromptSections as PromptSectionsLike } from '../../../prompts/prompt-library';
import {
  AgentRunNode,
  nodeRoles,
  type FlowCtx,
  type NodePromptPreview,
  type PromptPreviewParams,
  type RunOutcome,
  type SplitUnit,
} from '../../shared';
import type { NodeCapabilities } from '../../shared/capabilities';
import { NODE_KEYS } from '../../../constants/node-keys';

import { DEFAULT_MCP_SOURCES, configString, mcpSourcesOf, mcpSourcesSchema } from '../../../templates/node-config';
import { agentRunner, type AgentRunner } from '../../../harness';
import { flowCtxHelper, nodeSupport, type FlowContextHelper, type NodeSupport } from '../../shared';
import { PlanInput, PlanOutput } from './schema';
import { AgentOutputError, type AgentOutputError as AgentOutputErrorT } from '../../shared/agent/output-error';
import { parseFollowUp } from './plan-followup';

import { PROMPT_KEYS } from './constants/promptKeys';
import { AGENT_CONFIG_FIELDS } from './constants/config';
import { RETRYABLE_OUTPUT_ERRORS } from './constants/retryableErrors';
import {
  PLAN_APPLY_ALLOWED,
  PLAN_CHAT_LABEL,
  PLAN_CHAT_RETRY_LABEL,
  PLAN_RETRY_NO_PLAN,
  REFINED_FROM_SOURCE,
  planRefusalReason,
  planRefusedReply,
  planUpdateIgnoredEvent,
  planValidationFailedEvent,
  planValidationRefusalReply,
  type RefinedFrom,
} from './constants/refine';

import { PlanStore } from './plan-store';
import { PlanContextBlocks } from './plan-context';
import { PlanPromptBuilder, type ExecutionKnob } from './plan-prompt';
import { PlanOutputContract } from './plan-contract';
import { PlanSplitter } from './plan-split';

import type { PlanRunArgs } from './types';
import type { ContextBlockInfo } from './types/contextBlocks';

/**
 * The Plan node (the chat's first-class node): a thin orchestrator over its
 * plan-domain collaborators — {@link PlanStore} (data + publish),
 * {@link PlanContextBlocks} ({{context}} registry), {@link PlanPromptBuilder}
 * (whole/scoped prompts + run intent), {@link PlanOutputContract} (validation +
 * bounded retry + version publish) and {@link PlanSplitter} (the branch split
 * source port). The class owns the declarative surface (identity, config
 * knobs, capabilities, previews) and the run/recover wiring; all plan-domain
 * behavior lives in the collaborators.
 *
 * The conversation surface is the plan kind's own (§3a): `chat()` is the
 * follow-up contract — never the base rerun-with-feedback recipe.
 */
export class PlanNode extends AgentRunNode<PlanInput, PlanOutput> {
  readonly key = NODE_KEYS.PLAN;
  readonly label = 'Plan';
  readonly promptKeys = PROMPT_KEYS;
  /** the settings page's editable plan section (the other keys are run-time sub-templates) */
  readonly promptSections = ['plan'] as const;
  readonly order = 10;
  readonly edges = [[NODE_KEYS.BUILD, 'next']] as const;

  /**
   * The plan is the chat's first-class node: refine mode, the prompt preview
   * before the first run, and the panel title (the chat panel keys all of
   * this off these capabilities — no node-key checks).
   */
  override readonly capabilities: NodeCapabilities = {
    refinable: true,
    chatOnlyMode: 'refine',
    promptNode: NODE_KEYS.PLAN,
    panelTitle: 'Implementation plan',
  };

  /** Engine-dispatch metadata (§T3): the plan approval is a built-in flow
   *  action (refine), the plan kind occupies the chain's plan role, and the
   *  "plan" artifact is the first-class resource the editor/approvals consume. */
  override readonly builtinApproval = true;
  override readonly chainRole = NODE_KEYS.PLAN;
  override readonly resourceArtifacts = [NODE_KEYS.PLAN] as const;

  readonly inputSchema = PlanInput;
  readonly outputSchema = PlanOutput;

  /** Typed config knobs (defaults = today's behavior). */
  readonly configSchema = z.object({
    /** user-editable prompt body (foldable per template/flow; the global overlay was removed) */
    prompt_body: z.string().optional(),
    /**
     * User-added rules appended after the prompt body, before the engine's
     * locked internal blocks (rules + output contract + run data) — for every
     * run of this node (template runs, config-body runs and modal-edited runs
     * alike). The prompt modal previews and edits it via set_node_config.
     */
    prompt_rules: z.string().optional(),
    /** default for starts that don't pass `decompose` explicitly */
    decompose_default: z.boolean().default(false),
    /**
     * Plan fan-out (§1 "who decides the mode"): the published execution
     * resolution. `follow` = the PLANNER decides per plan version — the
     * plan prompt gains the execution directive and the response's
     * `execution` + `execution_rationale` are published in plan-meta
     * (unknown/missing ⇒ whole, never a parse failure). Its "steps" choice
     * fans the plan's branches out as one child flow per branch via the
     * split runtime (overridable at approve). The published value rides
     * every plan version in `artifacts.meta.execution` (source: knob |
     * planner | default | override), and the plan panel offers the
     * override at approve.
     */
    execution_default: z.enum(['whole', 'follow']).default('whole'),
    /** ambient MCP servers for plan agent runs — defaults to ALL sources enabled */
    mcp_sources: mcpSourcesSchema.default(DEFAULT_MCP_SOURCES),
  });

  readonly configFields = AGENT_CONFIG_FIELDS;

  /** The plan-domain collaborators — built on the node's own support/runner/
   *  ctxHelper so tests overriding the node constructors get the same seams
   *  downstream (§3.1). */
  private readonly store: PlanStore;
  private readonly context: PlanContextBlocks;
  private readonly prompt: PlanPromptBuilder;
  private readonly contract: PlanOutputContract;
  private readonly splitter: PlanSplitter;

  constructor(
    support: NodeSupport = nodeSupport,
    runner: AgentRunner = agentRunner,
    ctxHelper: FlowContextHelper = flowCtxHelper,
  ) {
    super(support, runner, ctxHelper);
    this.store = new PlanStore(support);
    this.context = new PlanContextBlocks(support, this.store, ctxHelper);
    this.prompt = new PlanPromptBuilder(ctxHelper, this.context, this.store, ctx => this.executionDefault(ctx));
    this.contract = new PlanOutputContract(support, this.store, runner, ctx => this.executionDefault(ctx), this.label);
    this.splitter = new PlanSplitter(this.store, ctx => this.executionDefault(ctx));
  }

  async run(ctx: FlowCtx, input: PlanInput, config: Record<string, unknown>): Promise<RunOutcome> {
    // the template/flow-layer prompt body knob folds into the existing
    // user-body path (per-run input.prompt still wins)
    if (!input.prompt && typeof config.prompt_body === 'string' && config.prompt_body.trim()) {
      input = { ...input, prompt: config.prompt_body, promptIsBody: true };
    }
    // the user's standing rules (prompt_rules knob) apply to every run —
    // template runs, config-body runs and modal-edited runs alike
    const userRules = typeof config.prompt_rules === 'string' ? config.prompt_rules : '';
    const node = this.node(ctx);

    // Branch-scoped path (§2/§3): refine ONE branch's sub-plan.
    const scoped = input.branchRef ? this.store.scopedRefine(ctx.flow.id, input.branchRef) : null;
    if (input.branchRef && !scoped) {
      // Edge case (§9): branchRef on a plan without branches or an unknown
      // branch name → fall back to a whole-plan refine with a lifecycle note,
      // never hard-fail.
      this.support.emitLifecycle(
        ctx.flow.id,
        node.id,
        `branch "${input.branchRef}" not found in the current plan — refining the whole plan instead`
      );
    }

    const prompt = scoped
      ? this.prompt.scoped(ctx, scoped, input, userRules)
      : this.prompt.whole(ctx, node, input, userRules);
    const intent = this.prompt.runIntent(node, input, scoped);
    const args: PlanRunArgs = {
      label: intent.label,
      model: input.model,
      settingSources: mcpSourcesOf(config),
    };

    return this.execute(ctx, {
      // the run record: `input.prompt` is the exact final prompt (retry
      // fidelity + the modal's lastRun read from it)
      input: { ...input, prompt },
      prompt,
      agent: {
        mode: 'plan',
        name: `${args.label} ${ctx.task.key}`,
        followUpOn: intent.followUpOn,
        model: args.model,
        settingSources: args.settingSources,
      },
      label: args.label,
      finalize: result => this.contract.applyWithRetry(ctx, node, input, scoped, result, args),
    });
  }

  // ── the plan conversation (docs/plan-conversation-refine.md §3a–c) ────────

  /**
   * The conversation surface (§3a): a chat message becomes ONE agent turn on
   * the SAME session whose RESPONSE SCHEMA decides what it did — the follow-up
   * contract (`{ reply, plan? }`), never prose classification. This replaces
   * the inherited rerun-with-feedback recipe (the base `chat()` re-running
   * `run({ feedback })` unchanged is wrong for the plan: a question must not
   * re-emit the plan) — every OTHER agent-run node keeps the base recipe.
   *
   * - reply-only turn: just the reply. Node status, artifacts, the checklist
   *   and `current_node` are untouched (the same contract `converse()` keeps).
   * - plan-bearing turn: `applyPlanVersion` — the same whole-plan persist path
   *   as a refine, state-guarded (§3b) — then the reply.
   * - a contract-violating plan payload: ONE bounded feedback retry on the
   *   same session (§3c) and, if still invalid, a plain-language refusal —
   *   the turn NEVER fails the node or leaves a partial version.
   *
   * The agent is the node's latest (`followUpOn`); with none yet, a fresh agent
   * starts — the same fallback `run()`/`converse()` document (§8).
   */
  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    const config = this.nodeConfig(ctx);
    const node = this.node(ctx);
    const userRules = typeof config.prompt_rules === 'string' ? config.prompt_rules : '';
    const args: PlanRunArgs = {
      label: PLAN_CHAT_LABEL,
      model: model ?? null,
      settingSources: mcpSourcesOf(config),
    };
    const prompt = this.prompt.refineTurn(ctx, content, userRules);
    const result = await this.runner.executeRun(
      ctx,
      node.id,
      () =>
        this.runner.startAgent(ctx, {
          prompt,
          mode: 'plan',
          name: `${this.label} chat ${ctx.task.key}`,
          followUpOn: this.support.lastAgentId(node.id),
          model: args.model,
          settingSources: args.settingSources,
        }),
      args.label
    );

    const turn = parseFollowUp(result.result ?? '');
    if (turn.plan == null) return turn.reply;
    return this.applyFollowUpPlan(ctx, node, content, turn, args);
  }

  /**
   * The plan-bearing half with the §3c failure semantics: after ONE bounded
   * feedback retry on the same session, an invalid plan ends the turn as a
   * conversational refusal (with ONE lifecycle event) — no `failed` status,
   * no partial version. Guard refusals (§3b) come back as the reply here.
   */
  private async applyFollowUpPlan(
    ctx: FlowCtx,
    node: NodeRow,
    message: string,
    turn: { reply: string; plan: unknown },
    args: PlanRunArgs
  ): Promise<string> {
    let failure: AgentOutputErrorT;
    try {
      return await this.applyPlanVersion(ctx, node, message, turn);
    } catch (e) {
      if (!(e instanceof AgentOutputError) || !RETRYABLE_OUTPUT_ERRORS.has(e.code)) throw e;
      failure = e;
    }

    // §3c: the SAME retry machine the scoped refines ride — violations as the
    // feedback, the follow-up contract re-stated, one more turn on the session.
    this.support.emitLifecycle(
      ctx.flow.id,
      node.id,
      `${args.label} output contract failed — retrying with feedback (${failure.code})`
    );
    const retry = await this.runner.executeRun(
      ctx,
      node.id,
      () =>
        this.runner.startAgent(ctx, {
          prompt: this.contract.followUpRetryPrompt(failure),
          mode: 'plan',
          name: `${this.label} chat ${ctx.task.key}`,
          followUpOn: this.support.lastAgentId(node.id),
          model: args.model,
          settingSources: args.settingSources,
        }),
      PLAN_CHAT_RETRY_LABEL
    );
    const retryTurn = parseFollowUp(retry.result ?? '');
    if (retryTurn.plan == null) {
      return this.validationRefusal(ctx, node, PLAN_RETRY_NO_PLAN);
    }
    try {
      return await this.applyPlanVersion(ctx, node, message, retryTurn);
    } catch (e) {
      if (!(e instanceof AgentOutputError) || !RETRYABLE_OUTPUT_ERRORS.has(e.code)) throw e;
      return this.validationRefusal(ctx, node, this.firstViolation(e));
    }
  }

  /**
   * The §3b apply: validate the turn's plan against the follow-up contract
   * (identical messages to a normal refine's parse), guard the node state
   * BEFORE persisting, then the exact whole-plan persist path a refine runs —
   * `persistPlan` (checklist sync) + `applyOutcome` (agent cursor, output,
   * event). Validation throws the standard {@link AgentOutputError} for the
   * §3c bounded retry; a state-guard refusal returns its plain reason (the
   * reply still flows — §8 never a silent dead end), with ONE lifecycle event.
   */
  private async applyPlanVersion(
    ctx: FlowCtx,
    node: NodeRow,
    message: string,
    turn: { reply: string; plan: unknown }
  ): Promise<string> {
    const plan = this.contract.parseFollowUpPlan(turn); // throws → §3c bounded retry
    const nodeNow = this.node(ctx);
    const status = nodeNow.status ?? '';
    if (!PLAN_APPLY_ALLOWED.has(status)) {
      this.support.emitLifecycle(ctx.flow.id, nodeNow.id, planUpdateIgnoredEvent(status));
      return planRefusedReply(turn.reply, planRefusalReason(status));
    }
    const refined: RefinedFrom = {
      version: this.store.latestPlan(ctx.flow.id)?.art.version ?? 0,
      source: REFINED_FROM_SOURCE.CHAT,
    };
    const outcome = this.contract.applyChatPlan(ctx, nodeNow, plan, {
      feedback: message,
      refined,
    });
    this.applyOutcome(ctx, outcome);
    return turn.reply;
  }

  /** §3c: the turn's attempt ends as a conversational refusal + ONE lifecycle
   *  event — the developer can immediately reply on the same session. */
  private validationRefusal(ctx: FlowCtx, node: NodeRow, violation: string): string {
    this.support.emitLifecycle(ctx.flow.id, node.id, planValidationFailedEvent);
    return planValidationRefusalReply(violation);
  }

  /** The FIRST violation in plain words — the same headline a schema_mismatch
   *  run event shows (the empty case is genuinely possible: `agent_reported`). */
  private firstViolation(failure: AgentOutputErrorT): string {
    const issue = failure.detail.issues[0];
    if (issue == null || issue.message === '') return failure.detail.message;
    return issue.message;
  }

  async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<boolean> {
    // Scoped recovery is skipped: recover() can't distinguish a scoped
    // response from a whole-plan one, and a replayed scoped run must not be
    // silently merged. Decline so the node fails → the developer retries (the
    // retry stays scoped and re-enters the normal flow).
    try {
      const recorded = this.inputSchema.parse(node.input ?? {});
      if (recorded.branchRef) return false;
    } catch {
      /* unparseable input → fall through to whole-plan recovery */
    }

    if (result.status !== 'finished') return false;

    // The same contract a live finish passes: an unparseable or contract-
    // violating recorded result is not recoverable — the node fails for a
    // manual retry (the standard agent-node recovery posture). The outcome
    // itself (parse + version publish + checklist sync) lives in the contract.
    const outcome = this.contract.recoverOutcome(ctx, node, result);
    if (!outcome) return false;

    this.applyOutcome(ctx, outcome, {
      note: `recovered: ${note}`,
    });
    return true;
  }

  // ── split source port — the plan's branches (the node makes the method
  //    identity the engine's port check keys off; the logic is the splitter's) ─

  override splitUnits(ctx: FlowCtx): SplitUnit[] | null {
    return this.splitter.units(ctx);
  }

  override splitResolution(ctx: FlowCtx): 'whole' | 'per-unit' | null {
    return this.splitter.resolution(ctx);
  }

  // ── prompt previews (used by the prompt route) ────────────────────────────

  /**
   * Live prompt preview (verbatim from the route's former plan case): the
   * feedback-refine preview renders the plan_refine template when a feedback
   * text is given on a node with an agent to refine on; otherwise the plan
   * body (config knob or default) with the ticket vars.
   */
  previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): NodePromptPreview | null {
    if (params.feedback && node?.agent_id) {
      // feedback refine preview (follow-up on the plan agent): the full
      // body-only refine template with the feedback rendered in. The context
      // block is run data — assembled at run time (PlanContextBlocks).
      const asm = prompts.assemblePrompt(
        'plan_refine',
        { ticket: this.ctxHelper.taskContext(ctx) },
        { feedback: params.feedback },
        { userRules: nodeRoles.previewRules(this, node) }
      );
      return { templateKey: 'plan_refine', configBody: null, assembly: asm };
    }
    const configBody = nodeRoles.previewBody(this, node);
    const asm = prompts.assemblePrompt(
      NODE_KEYS.PLAN,
      { ticket: this.ctxHelper.taskContext(ctx), ticket_type: this.ctxHelper.taskLabel(ctx) },
      undefined,
      { body: configBody, userRules: nodeRoles.previewRules(this, node) }
    );
    return { templateKey: NODE_KEYS.PLAN, configBody, assembly: asm };
  }

  /**
   * Branch-scoped prompt preview for the prompt route (§7.2): the
   * developer-editable body ({{feedback}} blank — the developer types it) plus
   * the context block list so the PromptModal can render the picker.
   * Returns null when the branch is unknown (the route surfaces a 400).
   */
  previewSubPlanPrompt(
    ctx: FlowCtx,
    branchName: string,
    contextBlocks?: string[]
  ): ({ prompt: string; contextBlocks: ContextBlockInfo[]; appendsInternal: true } & PromptSectionsLike) | null {
    const scoped = this.store.scopedRefine(ctx.flow.id, branchName);
    if (!scoped) return null;
    const blocks = this.context.resolve(ctx, scoped);
    const vars = this.prompt.scopedVars(ctx, scoped, { feedback: '', contextBlocks: contextBlocks ?? [] });
    const asm = prompts.assemblePrompt(
      'plan_subplan_refine',
      vars,
      { feedback: '' },
      { userRules: configString(this.nodeConfig(ctx), 'prompt_rules') }
    );
    return { prompt: asm.body, contextBlocks: blocks, appendsInternal: true, ...sectionsOf(asm) };
  }

  /**
   * The plan node's `execution_default` knob (class ← app ← flow snapshot).
   * The knob domain is whole|follow; anything else → "whole" (the retired
   * "steps" legacy value included — old per-step configs degrade to the
   * default whole execution).
   */
  private executionDefault(ctx: FlowCtx): ExecutionKnob {
    const raw = this.nodeConfig(ctx)['execution_default'];
    return raw === 'follow' ? raw : 'whole';
  }
}
