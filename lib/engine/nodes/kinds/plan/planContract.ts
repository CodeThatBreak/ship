import "server-only";

import { z } from 'zod';
import type { AgentRunResult } from '../../../ports/agentPort';
import { planSteps } from '../../../runtime/planStepStore';
import { TemplateRenderer, type FlowCtx, type RunOutcome } from '../../shared/nodeSharedExports';
import { AGENT_OUTPUT_ERROR, AgentOutputError } from '../../shared/agent/outputError/outputErrorExports';
import type { AgentRunner, ExecuteRunResult } from '../../../harness/harnessExports';
import { RunSupersededError } from '../../../errors/runSupersededError';
import type { NodeSupport } from '../../shared/nodeSupport';
import type { NodeRow } from '../../../../db/rows';
import { extractJson } from '../agent/jsonSchemaLite';
import { BranchRefinement } from './branchRefinement';
import { planBodyDiverged } from './planPrompt';
import { RETRYABLE_OUTPUT_ERRORS } from './constants/retryableErrors';
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
  SubPlanResponse,
  withStepIds,
  type PlanInput,
  type PlanMeta,
  type SubPlanPatch,
} from './schema';
import type { PlanStore } from './planStore';
import type { ExecutionKnob } from './planPrompt';
import type { PlanRunArgs } from './types/planTypeExports';
import type { ScopedRefine } from './types/planTypeExports';

/** Which unified-turn routing path produced the agent response. */
export type PlanTurnKind = 'pre-publish' | 'whole' | 'branch';

/**
 * The plan output contract: validate the agent's plan-mode response
 * against the plan schemas, do the plan-domain work it implies (version
 * publish + checklist sync + deterministic scoped merge), and build the run
 * outcome — with ONE bounded self-heal retry when the first response misses
 * the contract. The artifact is saved HERE, not via `outcome.artifact`: the
 * output blob derives from the just-saved artifact row (id, version,
 * execution/scopedRefine provenance) — `applyOutcome` persists the rest.
 */
export class PlanOutputContract {
  constructor(
    private readonly support: NodeSupport,
    private readonly store: PlanStore,
    private readonly runner: AgentRunner,
    private readonly knobOf: (ctx: FlowCtx) => ExecutionKnob,
    private readonly label: string,
  ) {}

  /**
   * Validate the agent's text against the plan response contract. Throws the
   * standard {@link AgentOutputError}: `no_json`, the agent's error envelope
   * (`agent_reported`), or `schema_mismatch` carrying every violation — the
   * run trail shows what actually came back.
   */
  parse<T>(text: string, schema: z.ZodType<T>): T {
    const parsed = extractJson(text);
    if (parsed == null) {
      throw new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.NO_JSON,
        label: this.label,
        message: `${this.label}: the agent response contained no JSON — the plan response must be a single JSON object`,
        issues: [],
        response: text,
      });
    }
    // the agent's escape hatch: it answered with the standard error envelope
    // instead of contract-conforming output — convey its reason
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
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }));
      throw new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
        label: this.label,
        // the first violation stays the headline — the same human message the
        // old validator produced, now with every issue in the structured payload
        message: issues[0]?.message ?? `${this.label}: the plan response violated its schema`,
        issues,
        response: text,
      });
    }
    return result.data;
  }

  /**
   * Unified turn parse + apply: `PlanTurnOutput` envelope, then plan |
   * subPlan | subPlanPatch | reply-only. Throws {@link AgentOutputError} on
   * contract violations (including whole `plan` on branch turns).
   */
  applyTurnResult(
    ctx: FlowCtx,
    node: NodeRow,
    turnKind: PlanTurnKind,
    userMessage: string,
    text: string,
    scoped: ScopedRefine | null
  ): { reply: string; outcome: RunOutcome | null } {
    const envelope = this.parseTurnEnvelope(text);
    const reply = envelope.reply;
    const hasPlan = envelope.plan != null;
    const hasSub = envelope.subPlan != null;
    const hasPatch = envelope.subPlanPatch != null;

    if (!hasPlan && !hasSub && !hasPatch) {
      return { reply, outcome: null };
    }

    if (turnKind === 'branch') {
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
            issues: [{ path: "subPlan", message: "required on branch turns" }],
            response: text,
          });
        }
        return { reply, outcome: this.scopedSubPlanOutcome(ctx, node, scoped, subPlan) };
      }
      if (hasPatch) {
        const subPlanPatch = envelope.subPlanPatch;
        if (subPlanPatch == null) {
          throw new AgentOutputError({
            code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
            label: this.label,
            message: `${this.label}: branch turn missing subPlanPatch payload`,
            issues: [{ path: "subPlanPatch", message: "required on branch turns" }],
            response: text,
          });
        }
        return { reply, outcome: this.scopedPatchOutcome(ctx, node, scoped, subPlanPatch) };
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
      const nodeNow = this.support.nodeByKey(ctx.flow.id, node.node_key);
      const status = nodeNow.status ?? '';
      if (!PLAN_APPLY_ALLOWED.has(status)) {
        this.support.emitLifecycle(ctx.flow.id, nodeNow.id, planUpdateIgnoredEvent(status));
        throw new PlanApplyRefusedError(planRefusedReply(reply, planRefusalReason(status)));
      }
      const prevVersion = this.store.latestPlan(ctx.flow.id)?.art.version ?? 0;
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
          issues: [{ path: "plan", message: "required on whole/pre-publish turns" }],
          response: text,
        });
      }
      const outcome = this.applyValidatedPlan(ctx, nodeNow, plan, {
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
   * ONE bounded retry prompt for unified turns — re-states `PlanTurnOutput`
   * with turn-kind-specific guidance.
   */
  turnRetryPrompt(failure: AgentOutputError, turnKind: PlanTurnKind): string {
    const branch = turnKind === 'branch';
    const body =
      failure.code === AGENT_OUTPUT_ERROR.NO_JSON
        ? TemplateRenderer.compose('Your previous response could not be used: no JSON object could be parsed from it.')
            .addBlankLine()
            .addLine('Re-emit your ENTIRE response as a single JSON object.')
            .build()
        : TemplateRenderer.compose('Your previous response was valid JSON but violated the plan turn contract:')
            .addBlankLine()
            .addLines(failure.detail.issues.map(i => `  - ${i.path ? `${i.path}: ` : ''}${i.message}`))
            .addBlankLine()
            .addLine(
              branch
                ? 'Re-emit a single JSON object with "reply" and optionally "subPlanPatch" (preferred) or "subPlan" — never include "plan" on branch turns.'
                : 'Re-emit a single JSON object with "reply" and optionally "plan" when changing the plan document.'
            )
            .build();
    return TemplateRenderer.compose(body)
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
      return this.applyTurnResult(ctx, node, turnKind, userMessage, text, scoped);
    } catch (e: unknown) {
      if (e instanceof PlanApplyRefusedError) {
        return { reply: e.reply, outcome: null };
      }
      if (!(e instanceof AgentOutputError) || !RETRYABLE_OUTPUT_ERRORS.has(e.code)) throw e;
      return this.turnRetry(ctx, node, turnKind, userMessage, scoped, e, args);
    }
  }

  private async turnRetry(
    ctx: FlowCtx,
    node: NodeRow,
    turnKind: PlanTurnKind,
    userMessage: string,
    scoped: ScopedRefine | null,
    failure: AgentOutputError,
    args: PlanRunArgs
  ): Promise<{ reply: string; outcome: RunOutcome | null }> {
    this.support.emitLifecycle(
      ctx.flow.id,
      node.id,
      `${args.label} output contract failed — retrying with feedback (${failure.code})`
    );
    let retry: ExecuteRunResult;
    try {
      retry = await this.runner.executeRun(
        ctx,
        node.id,
        () =>
          this.runner.startAgent(ctx, {
            prompt: this.turnRetryPrompt(failure, turnKind),
            mode: 'plan',
            name: `${args.label} ${ctx.task.key}`,
            followUpOn: this.support.lastAgentId(node.id),
            model: args.model,
            settingSources: args.settingSources,
          }),
        `${args.label} retry`
      );
    } catch (e) {
      if (e instanceof RunSupersededError) {
        return { reply: '', outcome: null };
      }
      throw e;
    }
    try {
      return this.applyTurnResult(ctx, node, turnKind, userMessage, retry.result.result ?? '', scoped);
    } catch (e: unknown) {
      if (e instanceof PlanApplyRefusedError) {
        return { reply: e.reply, outcome: null };
      }
      if (!(e instanceof AgentOutputError) || !RETRYABLE_OUTPUT_ERRORS.has(e.code)) throw e;
      throw e;
    }
  }

  /**
   * The one whole-plan persist + outcome path: version publish with the
   * conversation/execution meta, checklist sync (`persistPlan` →
   * `syncFromPlan`), then awaiting approval. Shared by the run outcome and
   * the conversational apply so they can never drift.
   */
  private applyValidatedPlan(
    ctx: FlowCtx,
    node: NodeRow,
    plan: PlanResponse,
    opts: { userMessage: string; refined?: RefinedFrom }
  ): RunOutcome {
    const planMeta: PlanMeta = { steps: withStepIds(plan.steps), branches: plan.branches ?? [] };
    const { art, stepCount } = this.store.persistPlan({
      ctx,
      node,
      userMessage: opts.userMessage,
      text: plan.markdown,
      planMeta,
      plannerExecution: this.store.normalizePlannerExecution(plan),
      knob: this.knobOf(ctx),
      refined: opts.refined,
    });
    return this.planOutcome(art, planMeta, stepCount, plan.markdown, this.readRunModel(node));
  }

  private readRunModel(node: NodeRow): string | null {
    const input = node.input as { model?: string | null } | null;
    if (!input || input.model == null) return null;
    return input.model;
  }

  /**
   * Replay a finished unified turn from the recorded run snapshot + agent text.
   * Returns null when the snapshot or response cannot be applied.
   */
  recoverTurnOutcome(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, input: PlanInput): RunOutcome | null {
    if (result.status !== 'finished') return null;
    const turnKind = input.planTurnKind;
    if (!turnKind) return null;

    const branch = input.planThread?.trim() || null;
    const scoped = branch ? this.store.scopedRefine(ctx.flow.id, branch) : null;
    if (branch && !scoped) return null;

    try {
      const applied = this.applyTurnResult(
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
  recoverOutcome(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, input?: PlanInput): RunOutcome | null {
    if (!input?.planTurnKind) return null;
    return this.recoverTurnOutcome(ctx, node, result, input);
  }

  /** The scoped refine's tail: deterministic merge → new artifact version
   *  (plan markdown unchanged) → scoped checklist sync → awaiting approval. */
  private scopedSubPlanOutcome(ctx: FlowCtx, node: NodeRow, scoped: ScopedRefine, sub: SubPlanResponse): RunOutcome {
    const branchName = scoped.branch.name;

    const merged = BranchRefinement.merge(scoped.latest.meta, branchName, sub);
    const art = this.support.saveArtifact(node.id, ctx.flow.id, 'plan', scoped.latest.art.content, {
      ...scoped.latest.rawMeta,
      steps: merged.steps,
      branches: merged.branches,
      scopedRefine: { branch: branchName, from: scoped.latest.art.version },
      refinedFrom: { version: scoped.latest.art.version, source: REFINED_FROM_SOURCE.BRANCH },
    });

    const stepCount = planSteps.replaceBranch(
      ctx.flow.id,
      art.id,
      branchName,
      merged.steps.filter(s => s.branch === branchName)
    );

    const branchSteps = merged.steps.filter(s => s.branch === branchName);
    const oldSteps = scoped.latest.meta.steps.filter(s => s.branch === branchName);
    const { added, removed, changed } = BranchRefinement.diffSteps(oldSteps, branchSteps);
    const diffNote = `(+${added.length} / −${removed.length}${changed.length ? `, ${changed.length} changed` : ''})`;

    return {
      status: 'awaiting_approval',
      output: this.scopedOutputBlob(ctx, node, art, merged, branchName, scoped.latest.art.version),
      event: `branch '${branchName}' sub-plan refined · ${stepCount} steps ${diffNote} — other branches untouched`,
      reply: sub.markdown,
    };
  }

  private scopedPatchOutcome(
    ctx: FlowCtx,
    node: NodeRow,
    scoped: ScopedRefine,
    patch: SubPlanPatch
  ): RunOutcome {
    const branchName = scoped.branch.name;
    const merged = BranchRefinement.applyPatch(scoped.latest.meta, branchName, patch);
    const art = this.support.saveArtifact(node.id, ctx.flow.id, 'plan', scoped.latest.art.content, {
      ...scoped.latest.rawMeta,
      steps: merged.steps,
      branches: merged.branches,
      scopedRefine: { branch: branchName, from: scoped.latest.art.version },
      refinedFrom: { version: scoped.latest.art.version, source: REFINED_FROM_SOURCE.BRANCH },
    });

    const branchSteps = merged.steps.filter(s => s.branch === branchName);
    const stepCount = planSteps.replaceBranch(ctx.flow.id, art.id, branchName, branchSteps);

    const oldSteps = scoped.latest.meta.steps.filter(s => s.branch === branchName);
    const { added, removed, changed } = BranchRefinement.diffSteps(oldSteps, branchSteps);
    const diffNote = `(+${added.length} / −${removed.length}${changed.length ? `, ${changed.length} changed` : ''})`;

    return {
      status: 'awaiting_approval',
      output: this.scopedOutputBlob(ctx, node, art, merged, branchName, scoped.latest.art.version),
      event: `branch '${branchName}' sub-plan patched · ${stepCount} steps ${diffNote} — other branches untouched`,
      reply: patch.markdown ?? `Updated branch "${branchName}".`,
    };
  }

  private scopedOutputBlob(
    _ctx: FlowCtx,
    node: NodeRow,
    art: { id: string; version: number },
    merged: PlanMeta,
    branchName: string,
    fromVersion: number
  ): Record<string, unknown> {
    const branchAgents = this.readBranchAgents(node);
    const model = this.readRunModel(node);
    return {
      latestArtifact: art.id,
      version: art.version,
      branches: merged.branches,
      steps: merged.steps,
      scopedRefine: { branch: branchName, from: fromVersion },
      ...(model != null ? { model } : {}),
      ...(branchAgents ? { branchAgents } : {}),
    };
  }

  private readBranchAgents(node: NodeRow): Record<string, string> | undefined {
    if (!node.output) return undefined;
    const raw = node.output as { branchAgents?: Record<string, string> };
    return raw.branchAgents;
  }

  /** The whole-plan outcome: awaiting approval, the output blob pointing at
   *  the fresh artifact version, the lifecycle event. */
  planOutcome(
    art: { id: string; version: number },
    planMeta: PlanMeta,
    stepCount: number,
    text: string,
    model: string | null,
  ): RunOutcome {
    const branchNote = planMeta.branches.length
      ? ` (${planMeta.branches.length} branch${planMeta.branches.length > 1 ? 'es' : ''})`
      : '';
    const stepNote = stepCount ? ` · ${stepCount} steps` : '';
    return {
      status: 'awaiting_approval',
      output: {
        latestArtifact: art.id,
        version: art.version,
        ...(model != null ? { model } : {}),
        ...(planMeta.branches.length ? { branches: planMeta.branches } : {}),
        ...(planMeta.steps.length ? { steps: planMeta.steps } : {}),
      },
      event: `plan v${art.version} ready for review${branchNote}${stepNote}`,
      reply: text,
    };
  }
}

/** Conversational refusal from the §3b apply guard — not a contract retry. */
class PlanApplyRefusedError extends Error {
  constructor(readonly reply: string) {
    super(reply);
    this.name = 'PlanApplyRefusedError';
  }
}
