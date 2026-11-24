/**
 * PlanContextBlocks — the {{context}} registry: resolve (picker data) and
 * server-side assembly (defaults, explicit selection, skip). Everything is
 * stubbed NodeSupport/PlanStore/ctxHelper — no DB dependency beyond module
 * import (isolated temp DB per AGENTS.md §1).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-plan-context-')), 'test.db');

await import('../../registry');
const { PlanContextBlocks } = await import('./planContext');
import type { PlanStepRow } from '../../../runtime/planStepStore/types/planStep';
import type { FlowCtx, FlowContextHelper, NodeSupport } from '../../shared/nodeSharedExports';
import type { PlanStore } from './planStore';

/** A minimal live plan_steps row (the mapped shape PlanStore.liveRows returns). */
const row: PlanStepRow = {
  id: 'row-1',
  flowId: 'flow-1',
  artifactId: null,
  metaId: 's1',
  position: 0,
  title: 'Live row',
  detail: 'hand edit',
  files: '["a.ts"]',
  branch: null,
  status: 'pending',
  origin: 'agent',
  completedBy: null,
  createdAt: '',
  updatedAt: '',
};

const makeContexts = () => {
  const store = {
    liveRows: async () => [row],
  } as unknown as PlanStore;
  const support = { artifactsOfKind: () => [] } as unknown as NodeSupport;
  const ctxHelper = { taskContext: () => 'TASK CONTEXT' } as unknown as FlowContextHelper;
  return new PlanContextBlocks(support, store, ctxHelper);
};

const ctx = { flow: { id: 'flow-1' } } as unknown as FlowCtx;
const byId = (blocks: { id: string; text: string; chars: number; defaultOn: boolean; locked: boolean }[]) =>
  new Map(blocks.map(b => [b.id, b]));

describe('PlanContextBlocks.resolve — picker data', () => {
  it('defaults follow wholeDefault and live rows render in Hand edits', async () => {
    const blocks = byId(await makeContexts().resolve(ctx));
    expect(blocks.get('task')).toMatchObject({ text: 'TASK CONTEXT', defaultOn: true, locked: false });
    expect(blocks.get('edits')).toMatchObject({
      defaultOn: true,
      locked: false,
      text: expect.stringContaining('The developer already adjusted'),
    });
    expect(blocks.size).toBe(2);
  });

  it('chars mirrors the rendered text length', async () => {
    for (const b of await makeContexts().resolve(ctx)) expect(b.chars).toBe(b.text.length);
  });
});

describe('PlanContextBlocks.assemble — server-side assembly', () => {
  it('an empty selection falls back to the defaults', async () => {
    const text = await makeContexts().assemble(ctx, { contextBlocks: [] });
    expect(text).toContain('## Task context');
    expect(text).toContain('## Hand edits');
  });

  it('a non-empty selection wins over defaults; unknown ids drop silently; skip applies', async () => {
    const chosen = await makeContexts().assemble(ctx, { contextBlocks: ['edits', 'ghost'] });
    expect(chosen).toContain('## Hand edits');
    expect(chosen).not.toContain('## Task context');

    const skipped = await makeContexts().assemble(ctx, { contextBlocks: ['task'] }, { skip: ['task'] });
    expect(skipped).toBe('');
  });

  it('blocks render in the fixed registry order (§4)', async () => {
    const text = await makeContexts().assemble(ctx, { contextBlocks: ['edits', 'task'] });
    expect(text.indexOf('## Task context')).toBeLessThan(text.indexOf('## Hand edits'));
  });
});
