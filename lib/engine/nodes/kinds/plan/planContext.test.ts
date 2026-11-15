/**
 * PlanContextBlocks — the {{context}} registry: per-mode resolve (picker data)
 * and server-side assembly (defaults, explicit selection, pinned contract,
 * skipContract). Everything is stubbed NodeSupport/PlanStore/ctxHelper — no DB
 * dependency beyond module import (isolated temp DB per AGENTS.md §1).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-plan-context-')), 'test.db');

await import('../../registry');
const { PlanContextBlocks } = await import('./planContext');
import type { PlanStepRow } from '../../../runtime/planStepStore';
import type { PlanBranch, PlanStep } from './schema';
import type { FlowCtx, FlowContextHelper, NodeSupport } from '../../shared/nodeSharedExports';
import type { PlanStore } from './planStore';
import type { ScopedRefine } from './types/planTypeExports';

const step: PlanStep = { id: 's1', title: 'Live row', detail: 'hand edit', files: ['a.ts'], branch: 'auth' };
const branch = (name: string, scope: string): PlanBranch => ({
  name,
  title: name.toUpperCase(),
  scope,
  files: [`${name}.ts`],
  steps: [],
  dependsOn: [],
});

const latest = {
  art: { id: 'art_1', version: 3, content: '# Plan document' },
  meta: { steps: [step], branches: [branch('auth', 'logins'), branch('billing', 'invoices')] },
  rawMeta: {},
};
/** A minimal live plan_steps row (the mapped shape PlanStore.liveRows returns). */
const row: PlanStepRow = {
  id: 'row-1',
  flowId: 'flow-1',
  artifactId: null,
  metaId: 's1',
  position: 0,
  title: step.title,
  detail: 'hand edit',
  files: '["a.ts"]',
  branch: 'auth',
  status: 'pending',
  origin: 'agent',
  completedBy: null,
  subFlowId: null,
  createdAt: '',
  updatedAt: '',
};
const scoped: ScopedRefine = { latest, branch: latest.meta.branches[0], liveRows: [row] };

const makeContexts = () => {
  const store = {
    latestPlan: async () => latest,
    liveRows: async () => [row],
    stepsText: (rows: { title: string }[]) => rows.map(r => r.title).join('\n'),
    dependencySummaries: () => '- `billing` (BILLING): invoices',
  } as unknown as PlanStore;
  const support = { artifactsOfKind: () => [] } as unknown as NodeSupport;
  const ctxHelper = { taskContext: () => 'TASK CONTEXT' } as unknown as FlowContextHelper;
  return new PlanContextBlocks(support, store, ctxHelper);
};

const ctx = { flow: { id: 'flow-1' } } as unknown as FlowCtx;
const byId = (blocks: { id: string; text: string; chars: number; defaultOn: boolean; locked: boolean }[]) =>
  new Map(blocks.map(b => [b.id, b]));

describe('PlanContextBlocks.resolve — picker data per mode', () => {
  it('whole plan: scoped-only blocks are empty, unlocked; defaults follow wholeDefault', async () => {
    const blocks = byId(await makeContexts().resolve(ctx, null));
    expect(blocks.get('task')).toMatchObject({ text: 'TASK CONTEXT' });
    const scopedOnly: [string, boolean, string][] = [
      ['contract', false, ''], // wholeDefault
      ['current', false, ''], // wholeDefault
      ['edits', true, 'The developer already adjusted'], // wholeDefault; live rows render
    ];
    for (const [id, defaultOn, text] of scopedOnly) {
      expect(blocks.get(id)).toMatchObject({ defaultOn, locked: false, text: expect.stringContaining(text) });
    }
    expect(blocks.get('branches')).toMatchObject({ defaultOn: true, locked: false });
  });

  it('scoped refine: only OTHER branches render in "branches"; the contract is locked + rendered', async () => {
    const blocks = byId(await makeContexts().resolve(ctx, scoped));
    expect(blocks.get('branches')).toMatchObject({ text: '- `billing` (BILLING): invoices', defaultOn: false });
    expect(blocks.get('contract')).toMatchObject({ locked: true, defaultOn: true });
    expect(blocks.get('contract')?.text).toContain('- scope: logins');
    expect(blocks.get('contract')?.text).toContain('- `billing` (BILLING): invoices');
    expect(blocks.get('edits')).toMatchObject({ text: '', locked: false }); // scoped refines cover hand edits via Current
    expect(blocks.get('current')).toMatchObject({ text: expect.stringContaining('Live row') });
  });

  it('chars mirrors the rendered text length', async () => {
    for (const b of await makeContexts().resolve(ctx, scoped)) expect(b.chars).toBe(b.text.length);
  });
});

describe('PlanContextBlocks.assemble — server-side assembly', () => {
  it('an empty selection falls back to the per-mode defaults', async () => {
    const text = await makeContexts().assemble(ctx, { contextBlocks: [] }, scoped);
    // scopedDefault: task, contract (pinned), current — branches/edits are off
    expect(text).toContain('## Task context');
    expect(text).toContain('## Branch contract');
    expect(text).toContain('## Current sub-plan');
    expect(text).not.toContain('## Other branches');
    expect(text).not.toContain('## Hand edits');
  });

  it('skipContract removes the pinned block (its count still reports to the picker)', async () => {
    const asIs = await makeContexts().assemble(ctx, { contextBlocks: [] }, scoped);
    const skipped = await makeContexts().assemble(ctx, { contextBlocks: [] }, scoped, { skipContract: true });
    expect(asIs).toContain('## Branch contract');
    expect(skipped).not.toContain('## Branch contract');
  });

  it('a non-empty selection wins over defaults; unknown ids drop silently; skip applies', async () => {
    const chosen = await makeContexts().assemble(ctx, { contextBlocks: ['branches', 'ghost'] }, scoped);
    expect(chosen).toContain('## Other branches');
    expect(chosen).not.toContain('## Task context');

    const skipped = await makeContexts().assemble(ctx, { contextBlocks: ['branches'] }, null, { skip: ['branches'] });
    expect(skipped).toBe('');
  });

  it('blocks render in the fixed registry order across modes (§4)', async () => {
    const text = await makeContexts().assemble(ctx, { contextBlocks: ['edits', 'task', 'branches'] }, null);
    expect(text.indexOf('## Task context')).toBeLessThan(text.indexOf('## Other branches'));
    expect(text.indexOf('## Other branches')).toBeLessThan(text.indexOf('## Hand edits'));
  });
});
