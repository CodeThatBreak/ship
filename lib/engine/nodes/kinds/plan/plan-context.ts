import "server-only";

import type { FlowCtx, FlowContextHelper } from '../../shared';
import type { NodeSupport } from '../../shared/node-support';
import { CONTEXT_BLOCKS, CONTEXT_BLOCK_ORDER } from './constants/contextBlocks';
import type { PlanInput } from './schema';
import type { PlanStore } from './plan-store';
import type { ScopedRefine } from './types';
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

  /** A block id → its rendered text, from the mode's state (scoped or whole). */
  private readonly renderers: Record<ContextBlockId, (ctx: FlowCtx, scoped: ScopedRefine | null) => string> = {
    task: (ctx) => this.ctxHelper.taskContext(ctx),
    contract: (_ctx, scoped) => (scoped ? this.renderContract(scoped) : ''),
    current: (_ctx, scoped) => (scoped ? this.renderCurrent(scoped) : ''),
    branches: (ctx, scoped) => this.renderBranches(ctx.flow.id, scoped),
    edits: (ctx, scoped) => (scoped ? '' : this.renderEdits(ctx.flow.id)),
  };

  /** Resolve every block's rendered text (picker data + assembly source). */
  resolve(ctx: FlowCtx, scoped: ScopedRefine | null): ContextBlockInfo[] {
    const isScoped = Boolean(scoped);
    return CONTEXT_BLOCKS.map(spec => {
      const text = this.renderers[spec.id](ctx, scoped);
      return {
        id: spec.id,
        label: spec.label,
        description: spec.description,
        text,
        chars: text.length,
        defaultOn: isScoped ? spec.scopedDefault : spec.wholeDefault,
        locked: Boolean(spec.pinned) && isScoped,
      };
    });
  }

  /**
   * Assemble {{context}} from the block registry. Unknown ids are dropped
   * silently and logged at debug; the pinned `contract` block is always
   * included for scoped refines regardless of the client selection. An empty
   * selection falls back to the per-mode defaults (the minimal-context
   * recommendation).
   */
  assemble(
    ctx: FlowCtx,
    input: Pick<PlanInput, 'contextBlocks'>,
    scoped: ScopedRefine | null,
    opts: { skipContract?: boolean; skip?: ContextBlockId[] } = {}
  ): string {
    const blocks = this.resolve(ctx, scoped);
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
      if (b.locked)
        include.add(b.id); // pinned: `contract` for scoped refines
      else if (useDefaults ? b.defaultOn : selected.has(b.id)) include.add(b.id);
    }
    if (opts.skipContract) {
      // The contract is template-pinned (renders via {{scope}}/{{files}}/
      // {{dependsOn}}/{{dependsOnSummaries}}) — never duplicate it into
      // {{context}}. Its char count is still reported to the picker.
      include.delete('contract');
    }

    return CONTEXT_BLOCK_ORDER.flatMap(id => {
      if (!include.has(id)) return [];
      const b = byId.get(id);
      return b && b.text.length > 0 ? [`## ${b.label}\n${b.text}`] : [];
    }).join('\n\n');
  }

  /** Branch contract text — scope, files, and what the sub-plan may assume exists. */
  private renderContract(scoped: ScopedRefine): string {
    const b = scoped.branch;
    return [
      `- scope: ${b.scope || '(none stated)'}`,
      `- files: ${b.files?.length ? b.files.join(', ') : '(none stated)'}`,
      `- depends on: ${b.dependsOn.length ? b.dependsOn.join(', ') : '(none)'}`,
      this.store.dependencySummaries(scoped.latest, b),
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Current sub-plan block: prompt + live checklist rows (hand edits included). */
  private renderCurrent(scoped: ScopedRefine): string {
    const prompt = scoped.branch.subPlan?.prompt ? `"""\n${scoped.branch.subPlan.prompt}\n"""` : '(none yet)';
    return `Sub-plan prompt:\n${prompt}\n\nCurrent steps:\n${this.store.stepsText(scoped.liveRows)}`;
  }

  /** Sibling branches as title + scope summaries only. */
  private renderBranches(flowId: string, scoped: ScopedRefine | null): string {
    const branches = this.store.latestPlan(flowId)?.meta.branches ?? [];
    const others = scoped ? branches.filter(b => b.name !== scoped.branch.name) : branches;
    if (!others.length) return '';
    return others.map(b => `- \`${b.name}\` (${b.title}): ${b.scope || '(no scope)'}`).join('\n');
  }

  /** The developer's live hand edits — whole-plan refines only (§4). */
  private renderEdits(flowId: string): string {
    const all = this.store.liveRows(flowId);
    if (!all.length) return '';
    return (
      'The developer already adjusted the plan checklist like this — treat these as intent and ' +
      'preserve them unless the feedback changes them:\n' +
      all
        .map(
          r =>
            `- ${r.meta_id ?? r.id}: ${r.title}${r.detail ? ` — ${r.detail}` : ''}${r.branch ? ` (branch: ${r.branch})` : ''}`
        )
        .join('\n')
    );
  }
}
