import 'server-only';

import { z } from 'zod';
import type { AgentRunResult } from '../../../ports/agentPort';
import { TemplateRenderer, type FlowCtx, type RunOutcome } from '../../shared/nodeSharedExports';
import { AGENT_OUTPUT_ERROR, AgentOutputError } from '../../shared/agent/outputError/outputErrorExports';
import { AgentOutputPipeline } from '../../shared/agentOutput/agentOutputPipeline';
import { retryFeedbackBody } from '../../shared/agentOutput/utils/retryFeedback';
import { validateStandardAgentOutput } from '../../shared/agentOutput/utils/standardOutput';
import type { AgentRunner } from '../../../harness/harnessExports';
import { RunSupersededError } from '../../../errors/runSupersededError';
import type { NodeSupport } from '../../shared/nodeSupport';
import type { NodeRow } from '../../../../db/rows';
import { FLOW_STATUS } from '../../../../../constants/flow';
import { PlanApplyRefusedError } from './planApplyRefusedError';
import { PlanScopedOutcome } from './planScopedOutcome';
import { planBodyDiverged } from './utils/planBodyDiverged';
import { planOutcome, readRunModel } from './utils/planOutcome';
import {
  REFINED_FROM_SOURCE,
  PLAN_APPLY_ALLOWED,
  planRefusalReason,
  planRefusedReply,
  planUpdateIgnoredEvent,
  type RefinedFrom,
} from './constants/refine';
import {
  PLAN_TURN_OUTPUT_JSON_SCHEMA,
  PlanResponse,
  PlanTurnOutput,
  withStepIds,
  type PlanInput,
  type PlanMeta,
} from './schema';
import type { PlanStore } from './planStore';
import type { PlanRunArgs } from './types/planTypeExports';
import type { ScopedRefine } from './types/planTypeExports';
import { PlanTurnKind } from './constants/planTurn';

/**
 * The plan output contract: validate the agent's plan-mode response against
 * the plan schemas and apply what it implies — the whole-plan publish path
 * (version publish + checklist sync via `PlanStore.persistPlan`, then awaiting
 * approval) and the branch-scoped refine path (delegated to
 * {@link PlanScopedOutcome}) — plus the ONE bounded self-heal retry when a
 * response misses the contract. The artifact is saved HERE, not via
 * `outcome.artifact`: the output blob derives from the just-saved artifact row
 * (id, version, scopedRefine provenance) — `applyOutcome` persists
 * the rest.
 *
 * Invariant: a whole-plan turn is applied only while THIS turn still owns the
 * node's claim (§3b guard, fenced on OWNERSHIP) — a cancelled/retried
 * mid-turn refuses with {@link PlanApplyRefusedError}, never a silent
 * mid-run mutation. Must never parse or persist outside the plan schemas.
 */
export class PlanOutputContract {
  private readonly pipeline: AgentOutputPipeline;
  private readonly scoped: PlanScopedOutcome;

  constructor(
    private readonly support: NodeSupport,
    private readonly store: PlanStore,
    private readonly runner: AgentRunner,
    private readonly label: string
  ) {
    this.pipeline = new AgentOutputPipeline(support);
    this.scoped = new PlanScopedOutcome(support);
  }

  /**
   * Validate the agent's text against the plan response contract. Throws the
   * standard {@link AgentOutputError}: `no_json`, the agent's error envelope
   * (`agent_reported`), or `schema_mismatch` carrying every violation — the
   * run trail shows what actually came back. Delegates to the ONE shared
   * standard validation (step 05 — the private copy is gone).
   */
  parse<T>(text: string, schema: z.ZodType<T>): T {
    return validateStandardAgentOutput({
      label: this.label,
      text,
      schema,
      noJsonNote: 'the plan response must be a single JSON object',
      mismatchNote: `${this.label}: the plan response violated its schema`,
    });
  }

  /**
   * Unified turn parse + apply: `PlanTurnOutput` envelope, then plan |
   * subPlan | subPlanPatch | reply-only. Throws {@link AgentOutputError} on
   * contract violations (including whole `plan` on branch turns) and
   * {@link PlanApplyRefusedError} when the §3b apply guard refuses.
   */
  async applyTurnResult(
    ctx: FlowCtx,
    node: NodeRow,
    turnKind: PlanTurnKind,
    userMessage: string,
    text: string,
    scoped: ScopedRefine | null
  ): Promise<{ reply: string; outcome: RunOutcome | null }> {
    const envelope = this.parseTurnEnvelope(text);
    const reply = envelope.reply;
    const hasPlan = envelope.plan != null;
    const hasSub = envelope.subPlan != null;
    const hasPatch = envelope.subPlanPatch != null;

    if (!hasPlan && !hasSub && !hasPatch) {
      return { reply, outcome: null };
    }

    if (turnKind === PlanTurnKind.Branch) {
      if (hasPlan) {
        throw new AgentOutputError({
          code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
          label: this.label,
          message: `${this.label}: branch turns must not include a whole "plan" — use subPlan or subPlanPatch only`,
          issues: [{ path: 'plan', message: 'forbidden on branch turns — emit subPlan or subPlanPatch instead' }],
          response: text,
        });
      }
      if (!scoped) {
        throw new Error('branch turn apply requires scoped refine context');
      }
      if (hasSub) {
        const subPlan = envelope.subPlan;
        if (subPlan == null) {
          throw new AgentOutputError({
            code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
            label: this.label,
            message: `${this.label}: branch turn missing subPlan payload`,
            issues: [{ path: 'subPlan', message: 'required on branch turns' }],
            response: text,
          });
        }
        return { reply, outcome: await this.scoped.subPlanOutcome(ctx, node, scoped, subPlan) };
      }
      if (hasPatch) {
        const subPlanPatch = envelope.subPlanPatch;
        if (subPlanPatch == null) {
          throw new AgentOutputError({
            code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
            label: this.label,
            message: `${this.label}: branch turn missing subPlanPatch payload`,
            issues: [{ path: 'subPlanPatch', message: 'required on branch turns' }],
            response: text,
          });
        }
        return { reply, outcome: await this.scoped.patchOutcome(ctx, node, scoped, subPlanPatch) };
      }
    }

    if (hasSub || hasPatch) {
      throw new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
        label: this.label,
        message: `${this.label}: whole-plan turns must use "plan", not subPlan/subPlanPatch`,
        issues: [{ path: hasSub ? 'subPlan' : 'subPlanPatch', message: 'forbidden on whole/pre-publish turns' }],
        response: text,
      });
    }

    if (hasPlan) {
      const nodeNow = await this.support.nodeByKey(ctx.flow.id, node.nodeKey);
      const status = nodeNow.status ?? '';
      // §3b apply guard, fenced on OWNERSHIP (docs/coding-patterns.md §3.6,
      // not the raw status string): `sendChat` claims the node (running + a
      // fresh attempt token) before this turn dispatches, so the live row
      // legitimately reads `running` for the turn's OWN claim — the normal
      // path. Refuse only when the claim moved on (a different or cleared
      // attempt owns the node now — cancelled/retried mid-turn) or the node
      // sits in a non-allowed status (approved, done, …) — the conservative
      // default, never a silent mid-run mutation.
      const ownsClaim =
        status === FLOW_STATUS.RUNNING &&
        node.attemptId != null &&
        nodeNow.attemptId === node.attemptId;
      if (!ownsClaim && !PLAN_APPLY_ALLOWED.has(status)) {
        await this.support.emitLifecycle(ctx.flow.id, nodeNow.id, planUpdateIgnoredEvent(status));
        throw new PlanApplyRefusedError(planRefusedReply(reply, planRefusalReason(status)));
      }
      const prevVersion = (await this.store.latestPlan(ctx.flow.id))?.art.version ?? 0;
      const refined: RefinedFrom | undefined =
        turnKind === 'pre-publish'
          ? planBodyDiverged(userMessage)
            ? { version: prevVersion, source: REFINED_FROM_SOURCE.START }
            : undefined
          : { version: prevVersion, source: REFINED_FROM_SOURCE.CHAT };
      const plan = envelope.plan;
      if (plan == null) {
        throw new AgentOutputError({
          code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
          label: this.label,
          message: `${this.label}: whole-plan turn missing plan payload`,
          issues: [{ path: 'plan', message: 'required on whole/pre-publish turns' }],
          response: text,
        });
      }
      const outcome = await this.applyValidatedPlan(ctx, nodeNow, plan, {
        userMessage,
        refined,
      });
      return { reply, outcome };
    }

    return { reply, outcome: null };
  }

  /** Parses the unified turn envelope (`PlanTurnOutput`). */
  parseTurnEnvelope(text: string): PlanTurnOutput {
    return this.parse(text, PlanTurnOutput);
  }

  /**
   * ONE bounded retry prompt for unified turns — the shared feedback body
   * (step 05) plus turn-kind-specific guidance, re-stating `PlanTurnOutput`
   * through the generated directive.
   */
  turnRetryPrompt(failure: AgentOutputError, turnKind: PlanTurnKind): string {
    const branch = turnKind === 'branch';
    const extra = branch
      ? 'Branch turns: a single JSON object with "reply" and optionally "subPlanPatch" (preferred) or "subPlan" — never include "plan" on branch turns.'
      : 'Whole/pre-publish turns: a single JSON object with "reply" and optionally "plan" when changing the plan document.';
    return TemplateRenderer.compose(retryFeedbackBody(failure, { extraInstruction: extra }))
      .addBlankLine()
      .addBlankLine()
      .addLine(AgentOutputError.directive(PLAN_TURN_OUTPUT_JSON_SCHEMA))
      .build();
  }

  async applyTurnResultWithRetry(
    ctx: FlowCtx,
    node: NodeRow,
    turnKind: PlanTurnKind,
    userMessage: string,
    text: string,
    scoped: ScopedRefine | null,
    args: PlanRunArgs
  ): Promise<{ reply: string; outcome: RunOutcome | null }> {
    try {
      // the ONE bounded feedback loop (step 05): the pipeline validates each
      // response against the turn contract and spends `retryBudget` feedback
      // turns on retryable misses; `agent_reported` and exhaustion throw
      return await this.pipeline.run<{ reply: string; outcome: RunOutcome | null }>({
        ctx,
        nodeId: node.id,
        label: args.label,
        text,
        budget: args.retryBudget,
        validate: async (t) => {
          try {
            return await this.applyTurnResult(ctx, node, turnKind, userMessage, t, scoped);
          } catch (e: unknown) {
            if (e instanceof PlanApplyRefusedError) {
              return { reply: e.reply, outcome: null };
            }
            throw e;
          }
        },
        retryPrompt: (failure) => this.turnRetryPrompt(failure, turnKind),
        executeRetry: async (prompt) => {
          const retry = await this.runner.executeRun(
            ctx,
            node.id,
            async () =>
              this.runner.startAgent(ctx, {
                prompt,
                mode: 'plan',
                name: `${args.label} ${ctx.task.key}`,
                followUpOn: await this.support.lastAgentId(node.id),
                model: args.model,
                settingSources: args.settingSources,
              }),
            `${args.label} retry`
          );
          return retry.result.result ?? '';
        },
      });
    } catch (e: unknown) {
      // a superseded retry turn is not a contract failure — the claim moved
      // on (cancelled/retried mid-turn); the caller treats it as a quiet no-op
      if (e instanceof RunSupersededError) {
        return { reply: '', outcome: null };
      }
      throw e;
    }
  }

  /**
   * The one whole-plan persist + outcome path: version publish with the
   * conversation meta, checklist sync (`persistPlan` →
   * `syncFromPlan`), then awaiting approval. Shared by the run outcome and
   * the conversational apply so they can never drift.
   */
  private async applyValidatedPlan(
    ctx: FlowCtx,
    node: NodeRow,
    plan: PlanResponse,
    opts: { userMessage: string; refined?: RefinedFrom }
  ): Promise<RunOutcome> {
    const planMeta: PlanMeta = { steps: withStepIds(plan.steps), branches: plan.branches ?? [] };
    const { art, stepCount } = await this.store.persistPlan({
      ctx,
      node,
      userMessage: opts.userMessage,
      text: plan.markdown,
      planMeta,
      refined: opts.refined,
    });
    return planOutcome(art, planMeta, stepCount, plan.markdown, readRunModel(node));
  }

  /**
   * Replay a finished unified turn from the recorded run snapshot + agent text.
   * Returns null when the snapshot or response cannot be applied.
   */
  async recoverTurnOutcome(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, input: PlanInput): Promise<RunOutcome | null> {
    if (result.status !== 'finished') return null;
    const turnKind = input.planTurnKind;
    if (!turnKind) return null;

    const branch = input.planThread?.trim() || null;
    const scoped = branch ? await this.store.scopedRefine(ctx.flow.id, branch) : null;
    if (branch && !scoped) return null;

    try {
      const applied = await this.applyTurnResult(
        ctx,
        node,
        turnKind,
        input.turnUserMessage ?? '',
        result.result ?? '',
        scoped
      );
      return applied.outcome;
    } catch {
      return null;
    }
  }

  /** Unified-turn recovery only — no legacy `run()` replay. */
  async recoverOutcome(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, input?: PlanInput): Promise<RunOutcome | null> {
    if (!input?.planTurnKind) return null;
    return this.recoverTurnOutcome(ctx, node, result, input);
  }
}
