import { describe, expect, it, vi } from 'vitest';
import { db } from '../../../db/app';
import { NODE_LEASE_SECONDS } from '../../constants/leases';
import { WorktreeActivity } from './worktreeActivity';

describe('WorktreeActivity lifecycle events (CR-073)', () => {
  it('writes node_key (not the row id) into event data.nodeKey', async () => {
    const findFirst = vi
      .spyOn(db.prisma.node, 'findFirst')
      .mockResolvedValue({ nodeKey: 'build' } as never);
    const activity = new WorktreeActivity();
    const data = await activity.lifecycleData('flow-1', 'node-row-id', { branch: 'main' });

    expect(findFirst).toHaveBeenCalled();
    expect(data?.nodeKey).toBe('build');
    expect(data?.nodeKey).not.toBe('node-row-id');
    findFirst.mockRestore();
  });

  it('omits data entirely when there is no nodeKey and no extra payload', async () => {
    const findFirst = vi
      .spyOn(db.prisma.node, 'findFirst')
      .mockResolvedValue(null);
    const activity = new WorktreeActivity();
    const data = await activity.lifecycleData('flow-1', 'node-row-id');

    expect(data).toBeUndefined();
    findFirst.mockRestore();
  });
});

describe('WorktreeActivity node lease heartbeat', () => {
  it("extends the attributed node's lease so the reconciler sees the warm-up as alive", async () => {
    const exec = vi
      .spyOn(db.prisma, '$executeRawUnsafe')
      .mockResolvedValue(1);
    try {
      await new WorktreeActivity().touchNode('flow-1', 'node-row-id');
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
      const activity = new WorktreeActivity();
      await activity.touchNode('flow-1', null);
      await activity.touchNode('flow-1', undefined);
      expect(exec).not.toHaveBeenCalled();
    } finally {
      exec.mockRestore();
    }
  });
});
