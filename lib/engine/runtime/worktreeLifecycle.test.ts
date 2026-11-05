import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/app';
import { WorktreeManager } from './worktreeLifecycle';

describe('WorktreeManager lifecycle events (CR-073)', () => {
  it('writes node_key (not the row id) into event data.nodeKey', () => {
    const get = vi.spyOn(db, 'get').mockReturnValue({ node_key: 'build' });
    const mgr = new WorktreeManager();
    const data = (
      mgr as unknown as {
        lifecycleData: (
          flowId: string,
          nodeId: string | null | undefined,
          extra?: Record<string, unknown>
        ) => Record<string, unknown> | undefined;
      }
    ).lifecycleData('flow-1', 'node-row-id', { branch: 'main' });

    expect(get).toHaveBeenCalled();
    expect(data?.nodeKey).toBe('build');
    expect(data?.nodeKey).not.toBe('node-row-id');
    get.mockRestore();
  });
});

describe('WorktreeManager node heartbeat', () => {
  const asTouch = (mgr: WorktreeManager) =>
    (
      mgr as unknown as {
        touchNode: (flowId: string, nodeId: string | null | undefined) => void;
      }
    ).touchNode.bind(mgr);

  it("stamps the attributed node row so reconcile's start-grace skips the warm-up", () => {
    // @ts-expect-error mockReturnValue expects a RunResult, but we don't need to return anything
    const run = vi.spyOn(db, 'run').mockReturnValue(undefined);
    try {
      asTouch(new WorktreeManager())('flow-1', 'node-row-id');
      expect(run).toHaveBeenCalledTimes(1);
      const [sql, ...params] = run.mock.calls[0] as unknown as [string, unknown[]];
      expect(sql).toContain('UPDATE nodes SET updated_at');
      expect(params).toEqual([expect.any(String), 'node-row-id', 'flow-1']);
    } finally {
      run.mockRestore();
    }
  });

  it("is a no-op without a node attribution (flow-level events don't stamp strangers)", () => {
    // @ts-expect-error mockReturnValue expects a RunResult, but we don't need to return anything
    const run = vi.spyOn(db, 'run').mockReturnValue(undefined);
    try {
      const touch = asTouch(new WorktreeManager());
      touch('flow-1', null);
      touch('flow-1', undefined);
      expect(run).not.toHaveBeenCalled();
    } finally {
      run.mockRestore();
    }
  });
});
