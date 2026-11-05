import 'server-only';

import { z } from 'zod';
import type { AgentRunResult } from '../../../ports/agentPort';
import type { NodeRow } from '../../../../db/rows';
import { prompts } from '../../../prompts/promptLibrary';
import {
  AgentRunNode,
  nodeRoles,
  type ChatTurnOpts,
  type FlowCtx,
  type NodePromptPreview,
  type PromptPreviewParams,
  type RunOutcome,
  type SplitUnit,
} from '../../shared/nodeSharedExports';
import type { NodeCapabilities } from '../../shared/capabilities';
import { NODE_KEYS } from '../../../constants/nodeKeys';

import { DEFAULT_MCP_SOURCES, mcpSourcesOf, mcpSourcesSchema } from '../../../templates/nodeConfig';
import { agentRunner, type AgentRunner } from '../../../harness/harnessExports';
import { flowCtxHelper, nodeSupport, type FlowContextHelper, type NodeSupport } from '../../shared/nodeSharedExports';
import { PlanInput, PlanOutput } from './schema';
import {
  AgentOutputError,
  AGENT_OUTPUT_ERROR,
  type AgentOutputError as AgentOutputErrorT,
} from '../../shared/agent/outputError/outputErrorExports';
import { RunSupersededError } from '../../../errors/runSupersededError';
import { PlanAgentSessions } from './planAgentSessions';

import { PlanTurnKind } from './constants/planTurn';

import { PROMPT_KEYS } from './constants/promptKeys';
import { AGENT_CONFIG_FIELDS } from './constants/config/planConfigExports';
import { RETRYABLE_OUTPUT_ERRORS } from './constants/retryableErrors';
import { PLAN_CHAT_LABEL, planValidationFailedEvent, planValidationRefusalReply } from './constants/refine';
import { resolvePlanTurnPreviousStatus } from './planRetryRevert';

import { PlanStore } from './planStore';
import { PlanContextBlocks } from './planContext';
import { PlanPromptBuilder, type ExecutionKnob } from './planPrompt';
import { PlanOutputContract } from './planContract';
import { PlanSplitter } from './planSplit';

import type { PlanRunArgs } from './types/planTypeExports';
import { ValidationError } from '@/lib/errors';

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
 * The conversation surface is unified turns via {@link turn} (POST /chat).
 */
export class PlanNode extends AgentRunNode<PlanInput, PlanOutput> {
  readonly key = NODE_KEYS.PLAN;
  readonly label = 'Plan';
  readonly promptKeys = PROMPT_KEYS;
  /** the settings page's editable plan section (the other keys are run-time sub-templates) */
  override readonly promptSections = ['plan'] as const;
  readonly order = 10;
  override readonly edges = [[NODE_KEYS.BUILD, 'next']] as const;

  /**
   * The plan is the chat's first-class node: the composer-as-prompt
   * conversation mode, the prompt prefill before the first run, the first
   * run's send label, and the panel title (the chat panel keys all of this
   * off these capabilities — no node-key checks).
   */
  override readonly capabilities: NodeCapabilities = {
    refinable: true,
    chatMode: 'plan',
    promptNode: NODE_KEYS.PLAN,
    startLabel: 'Generate plan',
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
  override readonly configSchema = z.object({
    /** user-editable prompt body (foldable per template/flow; the global overlay was removed) */
    prompt_body: z.string().optional(),
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

  override readonly configFields = AGENT_CONFIG_FIELDS;

  /** The plan-domain collaborators — built on the node's own support/runner/
   *  ctxHelper so tests overriding the node constructors get the same seams
   *  downstream (§3.1). */
  private readonly store: PlanStore;
  private readonly context: PlanContextBlocks;
  private readonly prompt: PlanPromptBuilder;
  private readonly contract: PlanOutputContract;
  private readonly splitter: PlanSplitter;
  private readonly sessions: PlanAgentSessions;

  constructor(
    support: NodeSupport = nodeSupport,
    runner: AgentRunner = agentRunner,
    ctxHelper: FlowContextHelper = flowCtxHelper
  ) {
    super(support, runner, ctxHelper);
    this.store = new PlanStore(support);
    this.context = new PlanContextBlocks(support, this.store, ctxHelper);
    this.prompt = new PlanPromptBuilder(ctxHelper, this.context, this.store, ctx => this.executionDefault(ctx));
    this.contract = new PlanOutputContract(support, this.store, runner, ctx => this.executionDefault(ctx), this.label);
    this.splitter = new PlanSplitter(this.store, ctx => this.executionDefault(ctx));
    this.sessions = new PlanAgentSessions(support);
  }

  async run(_ctx: FlowCtx, _input: PlanInput, _config: Record<string, unknown>): Promise<RunOutcome> {
    throw new Error('The plan node only accepts input via POST /api/flows/:id/chat');
  }

  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    return this.turn(ctx, content, { model });
  }

  /**
   * Unified plan send (docs/architecture/plan-unified-turns.md): pre-publish,
   * whole-plan, or branch-thread turns through one envelope + apply path.
   */
  override async turn(
    ctx: FlowCtx,
    content: string,
    opts?: ChatTurnOpts
  ): Promise<string> {
    const branch = PlanSplitter.getPlanThread(opts?.thread);
    const config = this.parseRunConfig(this.nodeConfig(ctx));
    const node = this.node(ctx);
    const model = opts?.model ?? null;
    const settingSources = mcpSourcesOf(config);

    const base = { model, settingSources, branch, scoped: null } as const;

    if (branch) {
      const scoped = this.store.scopedRefine(ctx.flow.id, branch);
      if (!scoped) {
        throw new ValidationError(`branch "${branch}" not found in the current plan`);
      }
      return this.runPlanTurn(ctx, content, {
        ...base,
        previousStatus: opts?.previousStatus ?? null,
        turnKind: PlanTurnKind.Branch,
        label: `plan branch chat (${branch})`,
        scoped,
        prompt: this.prompt.scoped(ctx, scoped, content, []),
      });
    }

    const latest = this.store.latestPlan(ctx.flow.id);
    if (!latest) {
      const bootstrapInput = PlanInput.parse({
        prompt: content,
        promptIsBody: true,
      });

      return this.runPlanTurn(ctx, content, {
        ...base,
        previousStatus: opts?.previousStatus ?? null,
        turnKind: PlanTurnKind.PrePublish,
        label: PLAN_CHAT_LABEL,
        prompt: this.prompt.whole(ctx, node, bootstrapInput),
      });
    }

    return this.runPlanTurn(ctx, content, {
      ...base,
      previousStatus: opts?.previousStatus ?? null,
      turnKind: PlanTurnKind.Whole,
      label: PLAN_CHAT_LABEL,
      prompt: this.prompt.refineTurn(ctx, content),
    });
  }

  private async runPlanTurn(
    ctx: FlowCtx,
    content: string,
    opts: {
      turnKind: PlanTurnKind;
      label: string;
      model: string | null;
      settingSources: ReturnType<typeof mcpSourcesOf>;
      branch: string | null;
      scoped: ReturnType<PlanStore['scopedRefine']>;
      prompt: string;
      previousStatus: string | null;
    }
  ): Promise<string> {
    const node = this.node(ctx);
    // Engine `sendChat` passes pre-claim status (§T4 ChatTurnOpts). Otherwise
    // derive from the live row / recorded input (tests, retry replay).
    const priorInput = PlanInput.safeParse(node.input ?? {});
    const previousStatus =
      opts.previousStatus ??
      resolvePlanTurnPreviousStatus(
        node.status ?? "pending",
        priorInput.success ? priorInput.data : null,
      );
    const attemptId = node.attempt_id;
    // Todo: Revisit this, there should be only one source of truth for main agent id
    const mainAgentId = opts.branch ? (node.agent_id ?? this.support.lastAgentId(node.id)) : null;

    const followUpOnAgent = this.sessions.resolveFollowUp(node, opts.branch);

    const args: PlanRunArgs = {
      label: opts.label,
      model: opts.model,
      settingSources: opts.settingSources,
    };

    const finalInputPrompt = PlanInput.parse({
      planThread: opts.branch,
      planTurnKind: opts.turnKind,
      turnUserMessage: content,
      previousStatus,
      prompt: opts.prompt,
    });

    this.support.setNode(node.id, { input: JSON.stringify(finalInputPrompt) });

    const { result } = await this.runner.executeRun(
      ctx,
      node.id,
      () =>
        this.runner.startAgent(ctx, {
          prompt: opts.prompt,
          mode: 'plan',
          name: `${this.label} chat ${ctx.task.key}`,
          followUpOn: followUpOnAgent,
          model: args.model,
          settingSources: args.settingSources,
        }),
      args.label,
      { attemptId: attemptId ?? undefined }
    );

    try {
      const applied = await this.contract.applyTurnResultWithRetry(
        ctx,
        node,
        opts.turnKind,
        content,
        result.result ?? '',
        opts.scoped,
        args
      );

      const agentId = this.support.lastAgentId(node.id);

      if (agentId) {
        this.sessions.recordAgent(ctx, this.node(ctx), opts.branch, agentId, mainAgentId);
      }

      if (applied.outcome) {
        this.applyOutcome(ctx, applied.outcome, {
          fenceSuperseded: Boolean(attemptId),
          attemptId,
        });
        return applied.reply;
      }
      if (attemptId) {
        this.support.patchIfAttempt(node.id, attemptId, {
          status: previousStatus,
          ...(agentId ? { agent_id: agentId } : {}),
        });
      } else {
        this.support.setNode(node.id, {
          status: previousStatus,
          ...(agentId ? { agent_id: agentId } : {}),
        });
      }
      return applied.reply;
    } catch (e: unknown) {
      if (e instanceof RunSupersededError) {
        return '';
      }
      const revert = (patch: Record<string, unknown>) => {
        if (attemptId) {
          this.support.patchIfAttempt(node.id, attemptId, patch);
        } else {
          this.support.setNode(node.id, patch);
        }
      };
      if (e instanceof AgentOutputError && e.code === AGENT_OUTPUT_ERROR.AGENT_REPORTED) {
        revert({ status: previousStatus });
        return e.detail.reported?.reason ?? e.detail.message;
      }
      if (!(e instanceof AgentOutputError) || !RETRYABLE_OUTPUT_ERRORS.has(e.code)) throw e;
      revert({ status: previousStatus });
      this.support.emitLifecycle(ctx.flow.id, node.id, planValidationFailedEvent);
      return planValidationRefusalReply(this.firstViolation(e));
    }
  }

  /** The FIRST violation in plain words — the same headline a schema_mismatch
   *  run event shows (the empty case is genuinely possible: `agent_reported`). */
  private firstViolation(failure: AgentOutputErrorT): string {
    const issue = failure.detail.issues[0];
    if (issue == null || issue.message === '') return failure.detail.message;
    return issue.message;
  }

  async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<boolean> {
    if (result.status !== 'finished') return false;

    let recorded: PlanInput;
    try {
      recorded = this.inputSchema.parse(node.input ?? {});
    } catch {
      recorded = PlanInput.parse({});
    }

    if (!recorded.planTurnKind) return false;

    const branch = recorded.planThread?.trim() || null;
    const scoped = branch ? this.store.scopedRefine(ctx.flow.id, branch) : null;
    if (branch && !scoped) return false;
    try {
      const applied = this.contract.applyTurnResult(
        ctx,
        node,
        recorded.planTurnKind,
        recorded.turnUserMessage ?? '',
        result.result ?? '',
        scoped
      );
      if (applied.outcome) {
        this.applyOutcome(ctx, applied.outcome, { note: `recovered: ${note}` });
      } else {
        const previousStatus = recorded.previousStatus ?? 'awaiting_approval';
        const agentId = this.support.lastAgentId(node.id);
        this.support.setNode(node.id, {
          status: previousStatus,
          ...(agentId ? { agent_id: agentId } : {}),
        });
        this.support.emitLifecycle(ctx.flow.id, node.id, `recovered: ${note} (reply-only turn)`);
      }
      return true;
    } catch {
      return false;
    }
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
   * plan body (config knob or default) with the ticket vars. Without the
   * feedback-refine branch (docs/plan-conversation-refine.md §5 #7) this now
   * ALWAYS serves the `plan` template — refinements are conversation turns
   * (`chat()`), and branch refines prefill the composer via the branch route.
   */
  previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): NodePromptPreview | null {
    if (params.branch) {
      const scoped = this.store.scopedRefine(ctx.flow.id, params.branch);
      if (!scoped) return null;
      const vars = this.prompt.scopedVars(ctx, scoped, '', []);
      const asm = prompts.assemblePrompt('plan_subplan_refine', vars, { feedback: '' });
      return {
        templateKey: 'plan_subplan_refine',
        configBody: null,
        assembly: asm,
      };
    }

    const configBody = nodeRoles.previewBody(this, node);
    const asm = prompts.assemblePrompt(
      NODE_KEYS.PLAN,
      { ticket: this.ctxHelper.taskContext(ctx), ticket_type: this.ctxHelper.taskLabel(ctx) },
      undefined,
      { body: configBody }
    );
    return { templateKey: NODE_KEYS.PLAN, configBody, assembly: asm };
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
