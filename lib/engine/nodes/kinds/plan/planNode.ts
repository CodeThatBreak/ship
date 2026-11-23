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
} from '../../shared/nodeSharedExports';
import type { NodeCapabilities } from '../../shared/capabilities';
import { NODE_KEYS } from '../../../constants/nodeKeys';

import { DEFAULT_MCP_SOURCES, mcpSourcesSchema } from '../../../templates/schemas/mcpSources';
import { mcpSourcesOf } from '../../../templates/nodeConfig';
import { agentRunner, type AgentRunner } from '../../../harness/harnessExports';
import { flowCtxHelper, type FlowContextHelper, type NodeSupport } from '../../shared/nodeSharedExports';
import { nodeSupport } from '@/lib/composition/container';
import { PlanInput, PlanOutput } from './schema';
import {
  AgentOutputError,
  AGENT_OUTPUT_ERROR,
} from '../../shared/agent/outputError/outputErrorExports';
import { firstViolation } from '../../shared/agent/outputError/utils/firstViolation';
import { RunSupersededError } from '../../../errors/runSupersededError';
import type { RecoveryResult } from '../../shared/types/recovery';
import { toStatusOf } from '../../../runtime/transitions/utils/transitionLookup';
import type { EngineNodeStatus } from '../../../constants/nodeStatus';
import { PlanAgentSessions } from './planAgentSessions';

import { PlanTurnKind } from './constants/planTurn';

import { PROMPT_KEYS } from './constants/promptKeys';
import { MAIN_PLAN_THREAD_TAB_ID } from './constants/planThread';
import { AGENT_CONFIG_FIELDS } from './constants/config/planConfigExports';
import { RETRYABLE_OUTPUT_ERRORS } from '../../shared/agentOutput/constants/agentOutput';
import { PLAN_CHAT_LABEL, planValidationFailedEvent, planValidationRefusalReply } from './constants/refine';
import { resolvePlanTurnPreviousStatus } from './planRetryRevert';

import { PlanStore } from './planStore';
import { PlanContextBlocks } from './planContext';
import { PlanPromptBuilder } from './planPrompt';
import { PlanOutputContract } from './planContract';

import type { PlanRunArgs, ScopedRefine } from './types/planTypeExports';
import { ValidationError } from '@/lib/errors';

/** The branch thread a chat send targets — the main tab means an unthreaded whole-plan send. */
const planThreadOf = (thread?: string | null): string | null => {
  const trimmed = thread?.trim();
  if (!trimmed || trimmed === MAIN_PLAN_THREAD_TAB_ID) return null;
  return trimmed;
};

/**
 * The Plan node (the chat's first-class node): a thin orchestrator over its
 * plan-domain collaborators — {@link PlanStore} (data + publish),
 * {@link PlanContextBlocks} ({{context}} registry), {@link PlanPromptBuilder}
 * (whole/scoped prompts + run intent) and {@link PlanOutputContract}
 * (validation + bounded retry + version publish). The class owns the
 * declarative surface (identity, config knobs, capabilities, previews) and
 * the run/recover wiring; all plan-domain behavior lives in the collaborators.
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

  /** The plan is the chat's first-class node: composer-as-prompt mode, the
   *  pre-first-run prompt prefill, the send label, the panel title — the chat
   *  panel keys all of this off these capabilities (no node-key checks). */
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
  private readonly sessions: PlanAgentSessions;

  constructor(
    support: NodeSupport = nodeSupport,
    runner: AgentRunner = agentRunner,
    ctxHelper: FlowContextHelper = flowCtxHelper
  ) {
    super(support, runner, ctxHelper);
    this.store = new PlanStore(support);
    this.context = new PlanContextBlocks(support, this.store, ctxHelper);
    this.prompt = new PlanPromptBuilder(ctxHelper, this.context, this.store);
    this.contract = new PlanOutputContract(support, this.store, runner, this.label);
    this.sessions = new PlanAgentSessions(support);
  }

  async run(_ctx: FlowCtx, _input: PlanInput, _config: Record<string, unknown>): Promise<RunOutcome> {
    void _ctx;
    void _input;
    void _config;
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
    const branch = planThreadOf(opts?.thread);
    const config = this.parseRunConfig(await this.nodeConfig(ctx));
    const node = await this.node(ctx);
    const model = opts?.model ?? null;
    const settingSources = mcpSourcesOf(config);

    const base = { model, settingSources, branch, scoped: null } as const;

    if (branch) {
      const scoped = await this.store.scopedRefine(ctx.flow.id, branch);
      if (!scoped) {
        throw new ValidationError(`branch "${branch}" not found in the current plan`);
      }
      return this.runPlanTurn(ctx, content, {
        ...base,
        previousStatus: opts?.previousStatus ?? null,
        turnKind: PlanTurnKind.Branch,
        label: `plan branch chat (${branch})`,
        scoped,
        prompt: await this.prompt.scoped(ctx, scoped, content, []),
      });
    }

    const latest = await this.store.latestPlan(ctx.flow.id);
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
        prompt: await this.prompt.whole(ctx, node, bootstrapInput),
      });
    }

    return this.runPlanTurn(ctx, content, {
      ...base,
      previousStatus: opts?.previousStatus ?? null,
      turnKind: PlanTurnKind.Whole,
      label: PLAN_CHAT_LABEL,
      prompt: await this.prompt.refineTurn(ctx, content),
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
      scoped: ScopedRefine | null;
      prompt: string;
      previousStatus: string | null;
    }
  ): Promise<string> {
    const node = await this.node(ctx);
    // Engine `sendChat` passes pre-claim status (§T4 ChatTurnOpts). Otherwise
    // derive from the live row / recorded input (tests, retry replay).
    const priorInput = PlanInput.safeParse(node.input ?? {});
    const previousStatus =
      opts.previousStatus ??
      resolvePlanTurnPreviousStatus(
        node.status ?? "pending",
        priorInput.success ? priorInput.data : null,
      );
    const attemptId = node.attemptId;
    // One source of truth for the main agent id (step 05): the runs table via
    // `lastAgentId` — the node-row `agent_id` mirror lags the run row, so it
    // is not consulted here. (Removing the mirror column itself is step 06/07
    // scope; `PlanAgentSessions.recordAgent` still writes it for its readers.)
    const mainAgentId = opts.branch ? (await this.support.lastAgentId(node.id)) : null;

    const followUpOnAgent = await this.sessions.resolveFollowUp(node, opts.branch);

    const args: PlanRunArgs = {
      label: opts.label,
      model: opts.model,
      settingSources: opts.settingSources,
      retryBudget: this.retryBudget,
    };

    const finalInputPrompt = PlanInput.parse({
      planThread: opts.branch,
      planTurnKind: opts.turnKind,
      turnUserMessage: content,
      previousStatus,
      prompt: opts.prompt,
    });

    await this.support.setNode(node.id, { input: JSON.stringify(finalInputPrompt) });

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

      const agentId = await this.support.lastAgentId(node.id);

      if (agentId) {
        await this.sessions.recordAgent(ctx, await this.node(ctx), opts.branch, agentId, mainAgentId);
      }

      if (applied.outcome) {
        await this.applyOutcome(ctx, applied.outcome, {
          fenceSuperseded: Boolean(attemptId),
          attemptId,
        });
        return applied.reply;
      }
      // a reply-only turn: revert to the pre-claim status via the declared
      // chatRevert transition (attempt-fenced when this run holds the token)
      if (previousStatus == null) {
        throw new Error('chat turn cannot revert without a pre-claim status');
      }
      await this.revertChat(ctx, node, attemptId, toStatusOf('chatRevert', previousStatus), agentId ? { agent_id: agentId } : {});
      return applied.reply;
    } catch (e: unknown) {
      if (e instanceof RunSupersededError) {
        return '';
      }
      const revert = (status: string) =>
        this.revertChat(ctx, node, attemptId, toStatusOf('chatRevert', status));
      if (e instanceof AgentOutputError && e.code === AGENT_OUTPUT_ERROR.AGENT_REPORTED) {
        await revert(previousStatus ?? 'awaiting_approval');
        return e.detail.reported?.reason ?? e.detail.message;
      }
      if (!(e instanceof AgentOutputError) || !RETRYABLE_OUTPUT_ERRORS.has(e.code)) throw e;
      await revert(previousStatus ?? 'awaiting_approval');
      await this.support.emitLifecycle(ctx.flow.id, node.id, planValidationFailedEvent);
      return planValidationRefusalReply(firstViolation(e));
    }
  }

  /**
   * Revert a claimed node to its pre-claim status through the declared
   * `chatRevert` transition — fenced by the attempt token when this run
   * holds one, from-set fenced otherwise. The engine's chat claim owns the
   * `running` state this undo (step 02, Invariant 1: never a raw write).
   */
  private async revertChat(
    ctx: FlowCtx,
    node: NodeRow,
    attemptId: string | null,
    toStatus: EngineNodeStatus,
    patch: Record<string, unknown> = {},
  ): Promise<void> {
    if (attemptId) {
      await this.support.applyTransitionFenced({
        flowId: ctx.flow.id, nodeKey: node.nodeKey, nodeId: node.id, attemptId,
        key: 'chatRevert', toStatus, patch,
      });
    } else {
      await this.support.applyTransition(ctx.flow.id, node.nodeKey, 'chatRevert', { toStatus, patch });
    }
  }

  async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<RecoveryResult> {
    if (result.status !== 'finished') {
      return { kind: 'manual', reason: `the plan run ended with ${result.status}` };
    }

    let recorded: PlanInput;
    try {
      recorded = this.inputSchema.parse(node.input ?? {});
    } catch (e: unknown) {
      return { kind: 'manual', reason: `the recorded plan turn input is unparseable: ${e instanceof Error ? e.message : String(e)}` };
    }

    if (!recorded.planTurnKind) {
      return { kind: 'manual', reason: 'the recorded input has no plan turn to replay' };
    }

    const branch = recorded.planThread?.trim() || null;
    const scoped = branch ? await this.store.scopedRefine(ctx.flow.id, branch) : null;
    if (branch && !scoped) {
      return { kind: 'manual', reason: `branch thread "${branch}" has no scoped-refine context` };
    }
    try {
      const applied = await this.contract.applyTurnResult(
        ctx,
        node,
        recorded.planTurnKind,
        recorded.turnUserMessage ?? '',
        result.result ?? '',
        scoped
      );
      if (applied.outcome) {
        await this.applyOutcome(ctx, applied.outcome, { note: `recovered: ${note}` });
      } else {
        // reply-only recovered turn: revert through the declared chatRevert
        const previousStatus = recorded.previousStatus ?? 'awaiting_approval';
        const agentId = await this.support.lastAgentId(node.id);
        await this.revertChat(ctx, node, null, toStatusOf('chatRevert', previousStatus), agentId ? { agent_id: agentId } : {});
        await this.support.emitLifecycle(ctx.flow.id, node.id, `recovered: ${note} (reply-only turn)`);
      }
      return { kind: 'recovered' };
    } catch (e: unknown) {
      return { kind: 'manual', reason: `replaying the recorded plan turn failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // ── prompt previews (used by the prompt route) ────────────────────────────

  /**
   * Live prompt preview (verbatim from the route's former plan case): the
   * plan body (config knob or default) with the ticket vars. Without the
   * feedback-refine branch (docs/plan-conversation-refine.md §5 #7) this now
   * ALWAYS serves the `plan` template — refinements are conversation turns
   * (`chat()`), and branch refines prefill the composer via the branch route.
   */
  async previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): Promise<NodePromptPreview | null> {
    if (params.branch) {
      const scoped = await this.store.scopedRefine(ctx.flow.id, params.branch);
      if (!scoped) return null;
      const vars = await this.prompt.scopedVars(ctx, scoped, '', []);
      const asm = prompts.assemblePrompt('plan_subplan_refine', vars, { feedback: '' });
      return {
        templateKey: 'plan_subplan_refine',
        configBody: null,
        assembly: asm,
      };
    }

    const configBody = await nodeRoles.previewBody(this, node);
    const asm = prompts.assemblePrompt(
      NODE_KEYS.PLAN,
      { ticket: this.ctxHelper.taskContext(ctx), ticket_type: this.ctxHelper.taskLabel(ctx) },
      undefined,
      { body: configBody }
    );
    return { templateKey: NODE_KEYS.PLAN, configBody, assembly: asm };
  }
}
