import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../../db/app';
import { workspacePaths } from '../../../git/workspacePaths';
import { WorktreeRemover } from './worktreeRemover';
import { WorktreeSweeper } from './worktreeSweeper';

const makeLeftover = (root: string, flowId: string): string => {
  const dir = path.join(root, flowId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /elsewhere/worktrees/x/.git/worktrees/x\n');
  return dir;
};

describe('WorktreeSweeper unregistered leftovers', () => {
  it('removes an unregistered leftover whose flow is gone, keeps an active flow one', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-sweep-'));
    try {
      // the sweep joins and removes under the CANONICAL root spelling (macOS
      // /var → /private/var) — assert against realpath, like the sweeper does
      const canonRoot = fs.realpathSync.native(root);
      const deadDir = makeLeftover(root, 'flow-dead');
      const activeDir = makeLeftover(root, 'flow-active');
      const deadDirCanon = path.join(canonRoot, 'flow-dead');
      const activeDirCanon = path.join(canonRoot, 'flow-active');
      const findManyRemovals = vi.spyOn(db.prisma.worktreeRemoval, 'findMany').mockResolvedValue([]);
      const findManyRepos = vi.spyOn(db.prisma.repo, 'findMany').mockResolvedValue([]);
      const findFlow = vi
        .spyOn(db.prisma.flow, 'findUnique')
        // 'flow-dead' → gone; 'flow-active' → active (may still adopt it)
        .mockImplementation(((args: { where: { id: string } }) =>
          args.where.id === 'flow-active' ? Promise.resolve({ status: 'active' }) : Promise.resolve(null)) as never);
      const rmSpy = vi.spyOn(fs, 'rmSync');

      try {
        const sweeper = new WorktreeSweeper(new WorktreeRemover());
        const rootSpy = vi.spyOn(workspacePaths, 'worktreesRoot').mockReturnValue(root);
        try {
          await sweeper.sweepWorktrees();
        } finally {
          rootSpy.mockRestore();
        }

        expect(fs.existsSync(deadDir)).toBe(false);
        expect(fs.existsSync(activeDir)).toBe(true);
        expect(rmSpy).toHaveBeenCalledWith(deadDirCanon, { recursive: true, force: true });
        expect(rmSpy).not.toHaveBeenCalledWith(activeDirCanon, expect.anything());
      } finally {
        findManyRemovals.mockRestore();
        findManyRepos.mockRestore();
        findFlow.mockRestore();
        rmSpy.mockRestore();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('never treats a full clone (dot-git DIRECTORY) as a worktree leftover', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-sweep-'));
    const cloneDir = path.join(root, 'clone-1');
    fs.mkdirSync(path.join(cloneDir, '.git'), { recursive: true }); // full clone: .git DIRECTORY
    try {
      const findManyRemovals = vi.spyOn(db.prisma.worktreeRemoval, 'findMany').mockResolvedValue([]);
      const findManyRepos = vi.spyOn(db.prisma.repo, 'findMany').mockResolvedValue([]);
      const findFlow = vi.spyOn(db.prisma.flow, 'findUnique').mockResolvedValue(null);
      const rmSpy = vi.spyOn(fs, 'rmSync');

      try {
        const sweeper = new WorktreeSweeper(new WorktreeRemover());
        const rootSpy = vi.spyOn(workspacePaths, 'worktreesRoot').mockReturnValue(root);
        try {
          await sweeper.sweepWorktrees();
        } finally {
          rootSpy.mockRestore();
        }

        expect(fs.existsSync(cloneDir)).toBe(true);
        expect(rmSpy).not.toHaveBeenCalled();
      } finally {
        findManyRemovals.mockRestore();
        findManyRepos.mockRestore();
        findFlow.mockRestore();
        rmSpy.mockRestore();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
