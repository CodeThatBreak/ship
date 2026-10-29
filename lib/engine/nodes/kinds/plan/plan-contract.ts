import { z } from 'zod';
import type { AgentRunResult } from '../../../ports/agent-port';
import { planSteps } from '../../../runtime/plan-step-store';
import { TemplateRenderer, type FlowCtx, type RunOutcome } from '../../shared';
import { AGENT_OUTPUT_ERROR, AgentOutputError } from '../../shared/agent/output-error';
import type { AgentRunner } from '../../../harness';
import type { NodeSupport } from '../../shared/node-support';
import type { NodeRow } from '../../../../db/rows';
import { extractJson } from '../agent/json-schema-lite';
import { BranchRefinement } from './branch-refinement';
import { planBodyDiverged } from './plan-prompt';
import { RETRYABLE_OUTPUT_ERRORS } from './constants/retryableErrors';
import { REFINED_FROM_SOURCE, type RefinedFrom } from './constants/refine';
import {
  PLAN_FOLLOWUP_JSON_SCHEMA,
  PLAN_RESPONSE_JSON_SCHEMA,
  SUB_PLAN_RESPONSE_JSON_SCHEMA,
  PlanFollowUp,
  PlanResponse,
  SubPlanResponse,
  withStepIds,
  type PlanInput,
  type PlanMeta,
} from './schema';
import type { PlanStore } from './plan-store';
import type { ExecutionKnob } from './plan-prompt';
import type { PlanRunArgs } from './types';
import type { ScopedRefine } from './types';

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
   * Apply the plan output contract with one bounded self-heal: when the
   * response misses the contract (`no_json` / `schema_mismatch`), re-prompt
   * the SAME agent once with the violations as feedback and re-apply the
   * contract. A second miss throws the standard {@link AgentOutputError} and
   * fails the node loudly — the previous artifact version stays the latest
   * plan, and the developer retries.
   */
  async applyWithRetry(
    ctx: FlowCtx,
    node: NodeRow,
    input: PlanInput,
    scoped: ScopedRefine | null,
    result: AgentRunResult,
    args: PlanRunArgs
  ): Promise<RunOutcome> {
    try {
      return this.apply(ctx, node, input, result.result ?? '', scoped);
    } catch (e: unknown) {
      if (!(e instanceof AgentOutputError) || !RETRYABLE_OUTPUT_ERRORS.has(e.code)) throw e;
      return this.retry(ctx, node, input, scoped, e, args);
    }
  }

  /**
   * Validate the agent's text against the plan response contract, then do the
   * plan-domain work and build the outcome. Throws the standard
   * {@link AgentOutputError} on no JSON, the agent's error envelope, or schema
   * violations.
   */
  apply(ctx: FlowCtx, node: NodeRow, input: PlanInput, text: string, scoped: ScopedRefine | null): RunOutcome {
    if (scoped) return this.scopedOutcome(ctx, node, text, scoped);

    const plan = this.parse(text, PlanResponse);
    return this.applyValidatedPlan(ctx, node, plan, {
      feedback: input.feedback ?? '',
      refined: this.wholeRefineMeta(ctx, input),
    });
  }

  /**
   * The conversational apply (§3a/§3b/§6c): a VALIDATED follow-up plan payload
   * becomes a new version through the exact whole-plan persist path (the same
   * persist + outcome a normal refine produces, with the conversation meta:
   * `feedback` + §6c `refinedFrom`). Call only after parseFollowUpPlan.
   */
  applyChatPlan(
    ctx: FlowCtx,
    node: NodeRow,
    plan: PlanResponse,
    opts: { feedback: string; refined?: RefinedFrom }
  ): RunOutcome {
    return this.applyValidatedPlan(ctx, node, plan, opts);
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
    opts: { feedback: string; refined?: RefinedFrom }
  ): RunOutcome {
    const planMeta: PlanMeta = { steps: withStepIds(plan.steps), branches: plan.branches ?? [] };
    const { art, stepCount } = this.store.persistPlan({
      ctx,
      node,
      input: { feedback: opts.feedback },
      text: plan.markdown,
      planMeta,
      plannerExecution: this.store.normalizePlannerExecution(plan),
      knob: this.knobOf(ctx),
      refined: opts.refined,
    });
    return this.planOutcome(art, planMeta, stepCount, plan.markdown);
  }

  /**
   * §6c provenance for the run-node whole-plan paths: a run with `feedback` is
   * a produced refine (`chat` — both the legacy feedback-rerun and whole-plan
   * refine actions); a `promptIsBody` run whose body DIVERGED from the plan
   * template is `start` (a template-faithful body — including the first run —
   * records nothing; when in doubt: NO provenance).
   */
  private wholeRefineMeta(ctx: FlowCtx, input: PlanInput): RefinedFrom | undefined {
    const prev = this.store.latestPlan(ctx.flow.id)?.art.version ?? 0;
    if (input.feedback) return { version: prev, source: REFINED_FROM_SOURCE.CHAT };
    if (input.promptIsBody && planBodyDiverged(input.prompt)) {
      return { version: prev, source: REFINED_FROM_SOURCE.START };
    }
    return undefined;
  }

  /**
   * The chat follow-up's plan validation (§3b): the whole turn — `reply` +
   * `plan` — parses against the follow-up contract, so the plan child rides the
   * exact same issue set a normal refine parse produces (identical messages →
   * the §3c retry feedback and the raw-issue event payload stay truthful).
   * Thrown as the standard {@link AgentOutputError} (`schema_mismatch`).
   */
  parseFollowUpPlan(turn: { reply: string; plan: unknown }): PlanResponse {
    const missingPlan = (): AgentOutputError =>
      new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
        label: this.label,
        message: `${this.label}: the response carried no plan payload`,
        issues: [{ path: 'plan', message: 'the response carried no plan payload' }],
        response: JSON.stringify(turn),
      });
    if (turn.plan == null) throw missingPlan();
    const result = PlanFollowUp.safeParse(turn);
    if (!result.success) {
      const issues = result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }));
      throw new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
        label: this.label,
        message: issues[0]?.message ?? `${this.label}: the plan response violated its schema`,
        issues,
        response: JSON.stringify(turn),
      });
    }
    const plan = result.data.plan;
    // the pre-checked turn validated: an absent/null plan is exactly the
    // reply-only turn this method refuses to treat (caller bug — fails loudly)
    if (plan == null) throw missingPlan();
    return plan;
  }

  /**
   * The chat follow-up's ONE bounded retry (§3c — the same machine as the
   * scoped refine's): an AgentOutputError-grade feedback that re-states the
   * follow-up contract (reply + optional plan envelope) on the same agent
   * session, with the follow-up response schema as the directive.
   */
  followUpRetryPrompt(failure: AgentOutputError): string {
    const body =
      failure.code === AGENT_OUTPUT_ERROR.NO_JSON
        ? TemplateRenderer.compose('Your previous response could not be used: no JSON object could be parsed from it.')
            .addBlankLine()
            .addLine('Re-emit your ENTIRE response as a single JSON object.')
            .build()
        : TemplateRenderer.compose('Your previous response was valid JSON but violated the plan follow-up contract:')
            .addBlankLine()
            .addLines(failure.detail.issues.map(i => `  - ${i.path ? `${i.path}: ` : ''}${i.message}`))
            .addBlankLine()
            .addLine(
              'Re-emit the follow-up response as a single JSON object: "reply" always, and "plan" (the full plan response, contract below) when you are changing the plan.'
            )
            .build();
    return TemplateRenderer.compose(body)
      .addBlankLine()
      .addBlankLine()
      .addLine(AgentOutputError.directive(PLAN_FOLLOWUP_JSON_SCHEMA))
      .build();
  }

  /**
   * Parse + persist a whole-plan RECOVERED finish; null when the recorded
   * result is not recoverable (unparseable or contract-violating — the node
   * fails for a manual retry, the standard agent-node recovery posture).
   */
  recoverOutcome(ctx: FlowCtx, node: NodeRow, result: AgentRunResult): RunOutcome | null {
    let plan: PlanResponse;
    try {
      plan = this.parse(result.result ?? '', PlanResponse);
    } catch {
      return null;
    }
    const planMeta: PlanMeta = { steps: withStepIds(plan.steps), branches: plan.branches ?? [] };
    const { art, stepCount } = this.store.persistRecovery({
      ctx,
      node,
      text: plan.markdown,
      planMeta,
      plannerExecution: this.store.normalizePlannerExecution(plan),
    });
    return this.planOutcome(art, planMeta, stepCount, plan.markdown);
  }

  /** The scoped refine's tail: deterministic merge → new artifact version
   *  (plan markdown unchanged) → scoped checklist sync → awaiting approval. */
  private scopedOutcome(ctx: FlowCtx, node: NodeRow, text: string, scoped: ScopedRefine): RunOutcome {
    const sub = this.parse(text, SubPlanResponse);
    const branchName = scoped.branch.name;

    // Deterministic merge: everything outside this branch stays byte-identical.
    const merged = BranchRefinement.merge(scoped.latest.meta, branchName, sub);
    // §6c provenance rides BESIDE the scoped record: "a version with refinedFrom"
    // is "a produced refine" — branch-scoped refines produce one (diff banner).
    const art = this.support.saveArtifact(node.id, ctx.flow.id, 'plan', scoped.latest.art.content, {
      ...scoped.latest.rawMeta,
      steps: merged.steps,
      branches: merged.branches,
      scopedRefine: { branch: branchName, from: scoped.latest.art.version }, // provenance for the diff banner
      refinedFrom: { version: scoped.latest.art.version, source: REFINED_FROM_SOURCE.BRANCH },
    });

    // Sync the live checklist scoped, not wholesale (§5): rows of other
    // branches are never touched; this branch's hand edits were already part
    // of the refine's input — they come back as echoed intent, not clobbered
    // state.
    const stepCount = planSteps.replaceBranch(
      ctx.flow.id,
      art.id,
      branchName,
      merged.steps.filter(s => s.branch === branchName)
    );

    const oldSteps = scoped.latest.meta.steps.filter(s => s.branch === branchName);
    const { added, removed, changed } = BranchRefinement.diffSteps(oldSteps, sub.steps);
    const diffNote = `(+${added.length} / −${removed.length}${changed.length ? `, ${changed.length} changed` : ''})`;

    return {
      status: 'awaiting_approval',
      output: {
        latestArtifact: art.id,
        version: art.version,
        branches: merged.branches,
        steps: merged.steps,
        scopedRefine: { branch: branchName, from: scoped.latest.art.version },
      },
      event: `branch '${branchName}' sub-plan refined · ${stepCount} steps ${diffNote} — other branches untouched`,
      reply: sub.markdown,
    };
  }

  /** The whole-plan outcome: awaiting approval, the output blob pointing at
   *  the fresh artifact version, the lifecycle event. Public because the
   *  conversational apply (PlanNode.applyPlanVersion) reuses this exact
   *  outcome so a chat-produced version persists like a normal refine. */
  planOutcome(
    art: { id: string; version: number },
    planMeta: PlanMeta,
    stepCount: number,
    text: string
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
        ...(planMeta.branches.length ? { branches: planMeta.branches } : {}),
        ...(planMeta.steps.length ? { steps: planMeta.steps } : {}),
      },
      event: `plan v${art.version} ready for review${branchNote}${stepNote}`,
      reply: text,
    };
  }

  /**
   * One feedback turn on the same agent session (`followUpOn` = the run the
   * contract just failed), then re-apply the contract to its response. The
   * scoped retry re-appends the scoped directive — a scoped retry never
   * re-emits the full plan.
   */
  private async retry(
    ctx: FlowCtx,
    node: NodeRow,
    input: PlanInput,
    scoped: ScopedRefine | null,
    failure: AgentOutputError,
    args: PlanRunArgs
  ): Promise<RunOutcome> {
    this.support.emitLifecycle(
      ctx.flow.id,
      node.id,
      `${args.label} output contract failed — retrying with feedback (${failure.code})`
    );

    const retryPrompt = this.outputDirective(this.feedbackPrompt(failure, scoped != null), scoped != null);
    const retry = await this.runner.executeRun(
      ctx,
      node.id,
      () =>
        this.runner.startAgent(ctx, {
          prompt: retryPrompt,
          mode: 'plan',
          name: `${args.label} ${ctx.task.key}`,
          followUpOn: this.support.lastAgentId(node.id),
          model: args.model,
          settingSources: args.settingSources,
        }),
      `${args.label} retry`
    );
    return this.apply(ctx, node, input, retry.result ?? '', scoped);
  }

  /** The specific failure is the feedback: what the agent got wrong, in its
   *  own response's terms — the same human messages the trail shows. */
  private feedbackPrompt(failure: AgentOutputError, scoped: boolean): string {
    return failure.code === AGENT_OUTPUT_ERROR.NO_JSON
      ? TemplateRenderer.compose('Your previous response could not be used: no JSON object could be parsed from it.')
          .addBlankLine()
          .addLine('Re-emit your ENTIRE response as a single JSON object.')
          .build()
      : TemplateRenderer.compose('Your previous response was valid JSON but violated the output contract:')
          .addBlankLine()
          .addLines(failure.detail.issues.map(i => `  - ${i.path ? `${i.path}: ` : ''}${i.message}`))
          .addBlankLine()
          .addLine(
            scoped
              ? 'Re-emit ONLY your sub-plan response as a single JSON object.'
              : 'Re-emit the corrected JSON object.'
          )
          .build();
  }

  /** The plan output contract appended to a retry prompt: the schema the
   *  response must satisfy + the agent's error-envelope escape hatch (the
   *  same directive json-output agent nodes ride). */
  private outputDirective(body: string, scoped: boolean): string {
    return TemplateRenderer.compose(body)
      .addBlankLine()
      .addBlankLine()
      .addLine(AgentOutputError.directive(scoped ? SUB_PLAN_RESPONSE_JSON_SCHEMA : PLAN_RESPONSE_JSON_SCHEMA))
      .build();
  }
}
