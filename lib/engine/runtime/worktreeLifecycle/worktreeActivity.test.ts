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
    const run = vi.spyOn(db, 'run').mockResolvedValue(1);
    try {
      await new WorktreeActivity().touchNode('flow-1', 'node-row-id');
      expect(run).toHaveBeenCalledTimes(1);
      const [sql, ...args] = run.mock.calls[0];
      // DB-server clock stamp: interval arithmetic in SQL, never app Date.now()
      expect(sql).toBe(
        'UPDATE nodes SET lease_until = now() + make_interval(secs => $1) WHERE id=$2 AND flow_id=$3',
      );
      // never stamp a stranger's node: the update is fenced by the flow id
      expect(args).toEqual([NODE_LEASE_SECONDS, 'node-row-id', 'flow-1']);
    } finally {
      run.mockRestore();
    }
  });

  it("is a no-op without a node attribution (flow-level events don't stamp strangers)", async () => {
    const run = vi.spyOn(db, 'run').mockResolvedValue(0);
    try {
      const activity = new WorktreeActivity();
      await activity.touchNode('flow-1', null);
      await activity.touchNode('flow-1', undefined);
      expect(run).not.toHaveBeenCalled();
    } finally {
      run.mockRestore();
    }
  });
});
