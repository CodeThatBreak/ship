import 'server-only';

import { prompts } from '../../../prompts/promptLibrary';
import { type FlowCtx, type FlowContextHelper } from '../../shared/nodeSharedExports';
import type { NodeRow } from '../../../../db/rows';
import { PlanInput } from './schema';
import type { PlanContextBlocks } from './planContext';
import type { PlanStore } from './planStore';
import type { ScopedRefine } from './types/planTypeExports';

/**
 * The plan node's prompts: the whole-plan prompt (verbatim override or base
 * template), the branch-scoped sub-plan prompt and its template variables, and
 * the run intent (mode label + follow-up) the run orchestrator records.
 */
export class PlanPromptBuilder {
  constructor(
    private readonly ctxHelper: FlowContextHelper,
    private readonly context: PlanContextBlocks,
    private readonly store: PlanStore,
  ) {}

  /** Whole-plan / pre-publish conversation prompt (`plan_refine` assembly). */
  async refineTurn(ctx: FlowCtx, content: string): Promise<string> {
    // a conversation turn carries no context-picker selection — the whole-mode
    // defaults (task, branches, edits) are the recommendation (§4 "no mode state")
    const contextBlock = await this.context.assemble(ctx, { contextBlocks: [] }, null);
    return prompts.resolve('plan_refine', {}, { feedback: content, context: contextBlock });
  }

  /** Whole-plan prompt: verbatim override or base plan template (first run). */
  async whole(ctx: FlowCtx, node: NodeRow, input: PlanInput): Promise<string> {
    const baseCtx = { ticket: this.ctxHelper.taskContext(ctx), ticket_type: this.ctxHelper.taskLabel(ctx) };
    const refining = Boolean(input.prompt);
    const contextBlock = await this.context.assemble(ctx, input, null, {
      // the base template already renders {{ticket}} — a task context block
      // earns its place only on refinement prompts (+ branch refines)
      skip: refining ? [] : ['task'],
    });
    if (input.prompt) {
      return input.promptIsBody
        ? prompts.assemblePrompt('plan', baseCtx, { context: contextBlock }, { body: input.prompt }).final
        : input.prompt;
    }
    return prompts.resolve('plan', baseCtx, { context: contextBlock });
  }

  /**
   * Branch-scoped turn prompt (`plan_subplan_refine`).
   */
  scoped(ctx: FlowCtx, scoped: ScopedRefine, userMessage: string, contextBlocks: string[]): Promise<string> {
    return this.scopedVars(ctx, scoped, userMessage, contextBlocks).then(vars =>
      prompts.resolve('plan_subplan_refine', {}, vars)
    );
  }

  /** The scoped template's variables, built from the ref'd branch only (§2). */
  async scopedVars(ctx: FlowCtx, scoped: ScopedRefine, userMessage: string, contextBlocks: string[]): Promise<Record<string, string>> {
    const b = scoped.branch;
    const input = PlanInput.parse({ contextBlocks });
    return {
      branch: b.name,
      scope: b.scope || '(none stated)',
      files: b.files?.length ? b.files.join(', ') : '(none stated)',
      dependsOn: b.dependsOn.length ? b.dependsOn.join(', ') : '(none)',
      dependsOnSummaries: this.store.dependencySummaries(scoped.latest, b),
      subPlanPrompt: b.subPlan?.prompt || '(none yet — seed the sub-plan from the contract above)',
      currentSteps: this.store.stepsText(scoped.liveRows),
      feedback: userMessage,
      context: await this.context.assemble(ctx, input, scoped, { skipContract: true }),
    };
  }
}
