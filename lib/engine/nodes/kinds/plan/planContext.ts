import "server-only";

import type { FlowCtx, FlowContextHelper } from '../../shared/nodeSharedExports';
import type { NodeSupport } from '../../shared/nodeSupport';
import { CONTEXT_BLOCKS, CONTEXT_BLOCK_ORDER } from './constants/contextBlocks';
import type { PlanInput } from './schema';
import type { PlanStore } from './planStore';
import type { ContextBlockId, ContextBlockInfo } from './types/contextBlocks';

/**
 * The plan prompt's {{context}} subsystem — context block registry (§4): the
 * picker data (`resolve`) and the server-side assembly (`assemble`). Context is
 * ALWAYS assembled server-side (never trust client-assembled context, §7.5);
 * each block's rendered text lives in one registered renderer instead of a
 * switch.
 */
export class PlanContextBlocks {
  constructor(
    private readonly support: NodeSupport,
    private readonly store: PlanStore,
    private readonly ctxHelper: FlowContextHelper,
  ) {}

  /** A block id → its rendered text. */
  private readonly renderers: Record<ContextBlockId, (ctx: FlowCtx) => Promise<string>> = {
    task: (ctx) => Promise.resolve(this.ctxHelper.taskContext(ctx)),
    edits: (ctx) => this.renderEdits(ctx.flow.id),
  };

  /** Resolve every block's rendered text (picker data + assembly source). */
  async resolve(ctx: FlowCtx): Promise<ContextBlockInfo[]> {
    return Promise.all(CONTEXT_BLOCKS.map(async spec => {
      const text = await this.renderers[spec.id](ctx);
      return {
        id: spec.id,
        label: spec.label,
        description: spec.description,
        text,
        chars: text.length,
        defaultOn: spec.wholeDefault,
        locked: Boolean(spec.pinned),
      };
    }));
  }

  /**
   * Assemble {{context}} from the block registry. Unknown ids are dropped
   * silently and logged at debug. An empty selection falls back to the
   * defaults (the minimal-context recommendation).
   */
  async assemble(
    ctx: FlowCtx,
    input: Pick<PlanInput, 'contextBlocks'>,
    opts: { skip?: ContextBlockId[] } = {}
  ): Promise<string> {
    const blocks = await this.resolve(ctx);
    const selected = new Set(input.contextBlocks ?? []);
    const useDefaults = selected.size === 0;
    const byId = new Map<string, ContextBlockInfo>(blocks.map(b => [b.id as string, b]));
    const skip = new Set(opts.skip ?? []);

    const unknown = [...selected].filter(id => !byId.has(id));
    if (unknown.length) {
      console.debug(`[plan] dropped unknown context block ids: ${unknown.join(', ')}`);
    }

    const include = new Set<string>();
    for (const b of blocks) {
      if (skip.has(b.id)) continue;
      if (b.locked || (useDefaults ? b.defaultOn : selected.has(b.id))) include.add(b.id);
    }

    return CONTEXT_BLOCK_ORDER.flatMap(id => {
      if (!include.has(id)) return [];
      const b = byId.get(id);
      return b && b.text.length > 0 ? [`## ${b.label}\n${b.text}`] : [];
    }).join('\n\n');
  }

  /** The developer's live hand edits — treat them as intent (§4). */
  private async renderEdits(flowId: string): Promise<string> {
    const all = await this.store.liveRows(flowId);
    if (!all.length) return '';
    return (
      'The developer already adjusted the plan checklist like this — treat these as intent and ' +
      'preserve them unless the feedback changes them:\n' +
      all
        .map(r => `- ${r.metaId ?? r.id}: ${r.title}${r.detail ? ` — ${r.detail}` : ''}`)
        .join('\n')
    );
  }
}
