import { describe, expect, it } from 'vitest';
import type { FlowCtx } from '../../nodes/shared/runContext';
import { WorktreeManager } from './worktreeManager';

const ctx = {} as FlowCtx; // the pin-win / plan-mode paths never touch the ctx

describe('WorktreeManager.ensureForRun (Option B contract)', () => {
  it('an explicit pin always wins — returned untouched, no manager involvement', async () => {
    const mgr = new WorktreeManager();
    const result = await mgr.ensureForRun(ctx, {
      mode: 'agent',
      cwd: '/explicit/pin',
      defaultBranch: 'build/whatever',
    });
    expect(result).toEqual({ cwd: '/explicit/pin', setupNote: null });
  });

  it('read-only runs (mode=plan) get no worktree', async () => {
    const mgr = new WorktreeManager();
    const result = await mgr.ensureForRun(ctx, { mode: 'plan', defaultBranch: 'build/whatever' });
    expect(result).toEqual({ cwd: undefined, setupNote: null });
  });
});
