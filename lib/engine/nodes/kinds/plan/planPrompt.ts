import 'server-only';

import { prompts } from '../../../prompts/promptLibrary';
import { type FlowCtx, type FlowContextHelper } from '../../shared/nodeSharedExports';
import type { NodeRow } from '../../../../db/rows';
import { PlanInput } from './schema';
import type { PlanContextBlocks } from './planContext';

/**
 * The plan node's prompts: the whole-plan prompt (verbatim override or base
 * template), the follow-up prompt, and the template variables the run
 * orchestrator records.
 */
export class PlanPromptBuilder {
  constructor(
    private readonly ctxHelper: FlowContextHelper,
    private readonly context: PlanContextBlocks,
  ) {}

  /** Whole-plan / pre-publish conversation prompt (`plan_refine` assembly). */
  async refineTurn(ctx: FlowCtx, content: string): Promise<string> {
    // a conversation turn carries no context-picker selection — the whole-mode
    // defaults (task, edits) are the recommendation (§4 "no mode state")
    const contextBlock = await this.context.assemble(ctx, { contextBlocks: [] });
    return prompts.resolve('plan_refine', {}, { feedback: content, context: contextBlock });
  }

  /** Whole-plan prompt: verbatim override or base plan template (first run). */
  async whole(ctx: FlowCtx, node: NodeRow, input: PlanInput): Promise<string> {
    const baseCtx = { ticket: this.ctxHelper.taskContext(ctx), ticket_type: this.ctxHelper.taskLabel(ctx) };
    const refining = Boolean(input.prompt);
    const contextBlock = await this.context.assemble(ctx, input, {
      // the base template already renders {{ticket}} — a task context block
      // earns its place only on refinement prompts
      skip: refining ? [] : ['task'],
    });
    if (input.prompt) {
      return input.promptIsBody
        ? prompts.assemblePrompt('plan', baseCtx, { context: contextBlock }, { body: input.prompt }).final
        : input.prompt;
    }
    return prompts.resolve('plan', baseCtx, { context: contextBlock });
  }
}
