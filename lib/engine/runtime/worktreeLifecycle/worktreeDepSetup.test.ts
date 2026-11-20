import { describe, expect, it } from 'vitest';
import type { Repo } from '../../../db/app';
import { WorktreeActivity } from './worktreeActivity';
import { WorktreeDepSetup } from './worktreeDepSetup';

const asRepo = (fields: Partial<Repo>) => fields as Repo;

describe('WorktreeDepSetup.depOverrides', () => {
  it('normalizes a repo row into the pure dep-policy override shape', () => {
    const setup = new WorktreeDepSetup(new WorktreeActivity());
    const overrides = setup.depOverrides(asRepo({
      installCommand: 'pnpm install',
      skipInstall: true,
      setupCommand: 'pnpm db:setup',
      syncPaths: '.env*',
      sharedDirs: 'data:uploads',
    }));

    expect(overrides).toEqual({
      install_command: 'pnpm install',
      skip_install: true,
      setup_command: 'pnpm db:setup',
      sync_paths: '.env*',
      shared_dirs: 'data:uploads',
    });
  });

  it('yields an empty override set without a repo row (defaults stay policy-owned)', () => {
    const setup = new WorktreeDepSetup(new WorktreeActivity());
    expect(setup.depOverrides(null)).toEqual({});
    expect(setup.depOverrides(undefined)).toEqual({});
  });
});
