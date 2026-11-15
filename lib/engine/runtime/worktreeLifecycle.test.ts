import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/app';
import { WorktreeManager } from './worktreeLifecycle';

describe('WorktreeManager lifecycle events (CR-073)', () => {
  it('writes node_key (not the row id) into event data.nodeKey', async () => {
    const findFirst = vi
      .spyOn(db.prisma.node, 'findFirst')
      .mockResolvedValue({ nodeKey: 'build' } as never);
    const mgr = new WorktreeManager();
    const data = await (
      mgr as unknown as {
        lifecycleData: (
          flowId: string,
          nodeId: string | null | undefined,
          extra?: Record<string, unknown>
        ) => Promise<Record<string, unknown> | undefined>;
      }
    ).lifecycleData('flow-1', 'node-row-id', { branch: 'main' });

    expect(findFirst).toHaveBeenCalled();
    expect(data?.nodeKey).toBe('build');
    expect(data?.nodeKey).not.toBe('node-row-id');
    findFirst.mockRestore();
  });
});

describe('WorktreeManager node heartbeat', () => {
  const asTouch = (mgr: WorktreeManager) =>
    (
      mgr as unknown as {
        touchNode: (flowId: string, nodeId: string | null | undefined) => Promise<void>;
      }
    ).touchNode.bind(mgr);

  it("stamps the attributed node row so reconcile's start-grace skips the warm-up", async () => {
    const updateMany = vi
      .spyOn(db.prisma.node, 'updateMany')
      .mockResolvedValue({ count: 1 });
    try {
      await asTouch(new WorktreeManager())('flow-1', 'node-row-id');
      expect(updateMany).toHaveBeenCalledTimes(1);
      const [payload] = updateMany.mock.calls[0] as unknown as [
        { where: { id: string; flowId: string }; data: { updatedAt: Date } },
      ];
      expect(payload.where).toEqual({ id: 'node-row-id', flowId: 'flow-1' });
      expect(payload.data.updatedAt).toEqual(expect.any(Date));
    } finally {
      updateMany.mockRestore();
    }
  });

  it("is a no-op without a node attribution (flow-level events don't stamp strangers)", async () => {
    const updateMany = vi
      .spyOn(db.prisma.node, 'updateMany')
      .mockResolvedValue({ count: 1 });
    try {
      const touch = asTouch(new WorktreeManager());
      await touch('flow-1', null);
      await touch('flow-1', undefined);
      expect(updateMany).not.toHaveBeenCalled();
    } finally {
      updateMany.mockRestore();
    }
  });
});
