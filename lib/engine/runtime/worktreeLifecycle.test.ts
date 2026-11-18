import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/app';
import { NODE_LEASE_SECONDS } from '../constants/leases';
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

describe('WorktreeManager node lease heartbeat', () => {
  const asTouch = (mgr: WorktreeManager) =>
    (
      mgr as unknown as {
        touchNode: (flowId: string, nodeId: string | null | undefined) => Promise<void>;
      }
    ).touchNode.bind(mgr);

  it("extends the attributed node's lease so the reconciler sees the warm-up as alive", async () => {
    const exec = vi
      .spyOn(db.prisma, '$executeRawUnsafe')
      .mockResolvedValue(1);
    try {
      await asTouch(new WorktreeManager())('flow-1', 'node-row-id');
      expect(exec).toHaveBeenCalledTimes(1);
      const [sql, leaseSeconds, nodeId, flowId] = exec.mock.calls[0] as unknown as [
        string, number, string, string,
      ];
      expect(sql).toContain('UPDATE nodes SET lease_until');
      expect(sql).toContain('make_interval');
      expect(leaseSeconds).toBe(NODE_LEASE_SECONDS);
      expect(nodeId).toBe('node-row-id');
      expect(flowId).toBe('flow-1');
    } finally {
      exec.mockRestore();
    }
  });

  it("is a no-op without a node attribution (flow-level events don't stamp strangers)", async () => {
    const exec = vi
      .spyOn(db.prisma, '$executeRawUnsafe')
      .mockResolvedValue(1);
    try {
      const touch = asTouch(new WorktreeManager());
      await touch('flow-1', null);
      await touch('flow-1', undefined);
      expect(exec).not.toHaveBeenCalled();
    } finally {
      exec.mockRestore();
    }
  });
});
