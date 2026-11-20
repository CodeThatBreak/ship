import { describe, expect, it, vi } from 'vitest';
import { workspacePaths } from '../../../git/workspacePaths';
import { WorktreeRemover } from './worktreeRemover';

describe('WorktreeRemover safety gate', () => {
  it('refuses a removal target outside the workspace dir without touching the db', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const remover = new WorktreeRemover();
      const done = await remover.removeWorktreeDir({
        flowId: null,
        repoPath: null,
        wtPath: '/definitely-not-the-devflow-workspace/some-wt',
        branch: null,
      });
      expect(done).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('refusing removal outside the workspace dir'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses a dangerous removal path inside the workspace (the hub itself)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = vi.spyOn(workspacePaths, 'worktreesRoot').mockReturnValue('/tmp/wt-gate-test-root');
    try {
      const remover = new WorktreeRemover();
      const done = await remover.removeWorktreeDir({
        flowId: 'flow-1',
        repoPath: '/tmp/wt-gate-test-root/hub',
        wtPath: '/tmp/wt-gate-test-root/hub',
        branch: 'mr/x',
      });
      expect(done).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('refusing dangerous removal path'),
      );
    } finally {
      warn.mockRestore();
      root.mockRestore();
    }
  });
});
