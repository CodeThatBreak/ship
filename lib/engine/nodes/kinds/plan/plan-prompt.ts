import { prompts } from '../../../prompts/prompt-library';
import { DEFAULT_PROMPT_TEMPLATES } from '../../../prompts/prompt-defaults';
import { TemplateRenderer, type FlowCtx, type FlowContextHelper } from '../../shared';
import type { NodeRow } from '../../../../db/rows';
import { PlanInput } from './schema';
import type { PlanContextBlocks } from './plan-context';
import type { PlanStore } from './plan-store';
import type { ScopedRefine } from './types';

/** The plan node's `execution_default` knob resolution. */
export type ExecutionKnob = 'whole' | 'follow';

/** @deprecated unused — plan node has no manual `run()`. */
export interface RunIntent {
  label: string;
  followUpOn: string | null;
}

/**
 * Whether a `promptIsBody` run body DIVERGES from the plan template's body
 * (§8 / §6c 'start' provenance): only a CLEARLY different body counts — the
 * comparison is the same normalization the assembly applies (trim + collapse
 * blank-line runs), so when in doubt the default is NO provenance (§6c).
 */
export function planBodyDiverged(prompt: string | null | undefined): boolean {
  if (!prompt?.trim()) return false;
  const norm = (s: string): string => s.trim().replace(/\n{3,}/g, "\n\n");
  return norm(prompt) !== norm(DEFAULT_PROMPT_TEMPLATES.plan.userTemplate);
}

/**
 * The plan node's prompts: the whole-plan prompt (verbatim override or base
 * template), the branch-scoped sub-plan prompt and its template variables, the
 * `follow`-mode execution directive, and the run intent (mode label + follow-up)
 * the run orchestrator records.
 */
export class PlanPromptBuilder {
  constructor(
    private readonly ctxHelper: FlowContextHelper,
    private readonly context: PlanContextBlocks,
    private readonly store: PlanStore,
    private readonly knobOf: (ctx: FlowCtx) => ExecutionKnob,
  ) {}

  /** Whole-plan / pre-publish conversation prompt (`plan_refine` assembly). */
  refineTurn(ctx: FlowCtx, content: string, userRules: string): string {
    // a conversation turn carries no context-picker selection — the whole-mode
    // defaults (task, branches, edits) are the recommendation (§4 "no mode state")
    const contextBlock = this.context.assemble(ctx, { contextBlocks: [] }, null);
    const refined = prompts.resolve(
      "plan_refine",
      {},
      { feedback: content, context: contextBlock },
      undefined,
      { userRules }
    );
    const execBlock = this.executionDirective(ctx);
    return execBlock ? `${refined}\n\n${execBlock}` : refined;
  }

  /** Whole-plan prompt: verbatim override or base plan template (first run). */
  whole(ctx: FlowCtx, node: NodeRow, input: PlanInput, userRules: string): string {
    const baseCtx = { ticket: this.ctxHelper.taskContext(ctx), ticket_type: this.ctxHelper.taskLabel(ctx) };
    const refining = Boolean(input.prompt);
    const contextBlock = this.context.assemble(ctx, input, null, {
      // the base template already renders {{ticket}} — a task context block
      // earns its place only on refinement prompts (+ branch refines)
      skip: refining ? [] : ['task'],
    });
    // Phase 3B (`execution_default: follow`): the planner decides how the
    // checklist executes. The directive is an APPENDED block — the default
    // templates (and every non-follow prompt) stay byte-for-byte; the block
    // rides the base/refine/promptIsBody paths so an "Edit prompt" run keeps
    // the output contract. The raw verbatim-prompt path is untouched
    // (feedback-echo refines skip it by definition).
    const execBlock = this.executionDirective(ctx);

    if (input.prompt) {
      return input.promptIsBody
        ? prompts.assemblePrompt('plan', baseCtx, { context: contextBlock }, { body: input.prompt, userRules }).final +
            (execBlock ? `\n\n${execBlock}` : '')
        : input.prompt;
    }
    const base = prompts.resolve('plan', baseCtx, { context: contextBlock }, undefined, { userRules });
    let prompt = base;

    if (input.decompose) {
      prompt +=
        this.ctxHelper.execMode(ctx) === 'local'
          ? '\n\nUse your built-in Task subagents to explore different areas of the repo in parallel, then merge the results into a single cohesive plan.'
          : '\n\nDelegate exploration of different repo areas to sub-agents, then merge the results into a single cohesive plan.';
    }
    if (execBlock) prompt += `\n\n${execBlock}`;

    return prompt;
  }

  /**
   * Branch-scoped turn prompt (`plan_subplan_refine`).
   */
  scoped(ctx: FlowCtx, scoped: ScopedRefine, userMessage: string, contextBlocks: string[], userRules: string): string {
    const vars = this.scopedVars(ctx, scoped, userMessage, contextBlocks);
    return prompts.resolve('plan_subplan_refine', {}, vars, undefined, { userRules });
  }

  /** The scoped template's variables, built from the ref'd branch only (§2). */
  scopedVars(
    ctx: FlowCtx,
    scoped: ScopedRefine,
    userMessage: string,
    contextBlocks: string[]
  ): Record<string, string> {
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
      context: this.context.assemble(ctx, input, scoped, { skipContract: true }),
    };
  }

  /**
   * The `follow`-mode planning directive (Phase 6's intended prompt delta —
   * the branch child-flow contract). Under every other knob this returns
   * null — non-follow prompts are byte-identical to the pre-Phase-6 text.
   * `auto_min_steps` does not exist as a knob: the ~N-branches consideration
   * is planner HINT text here, never a runtime threshold. Composed on the
   * TemplateComposer (Phase 5): skip-empty part semantics, no `join` array.
   */
  executionDirective(ctx: FlowCtx): string | null {
    if (this.knobOf(ctx) !== 'follow') return null;
    return TemplateRenderer.compose('## Execution resolution — add these two top-level fields to your JSON response')
      .addLine(
        "This flow's plan node is configured so YOU decide how the work executes after approval. Add exactly two top-level fields (everything else in the schema is unchanged):"
      )
      .addBlankLine()
      .addLine('  "execution": "whole" or "steps"')
      .addLine('  "execution_rationale": "<one line — why>"')
      .addBlankLine()
      .addLines([
        `- "whole": the entire plan builds in ONE agent run (a tightly-coupled change, shared files, branches that depend on each other mid-task).`,
        `- "steps": each declared BRANCH becomes its own monitorable child flow on its own review unit (an approved plan of independent branches). A branch-less plan executes whole either way.`,
        `- Consider "steps" when the plan decomposes into roughly 5+ fairly independent branches a reviewer would want to verify one at a time. Sibling branch agents cannot see each other's code, so when you pick "steps" declare "dependsOn" between branches that share files — the scheduler starts a branch only after its dependencies resolve — and keep each branch's "files" accurate.`,
        `- Prefer "whole" for anything entangled — a wrong call trades review granularity for stuck siblings.`,
      ])
      .build();
  }
}
