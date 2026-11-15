import "server-only";

import fs from "fs";
import path from "path";
import { db, type Database, type Repo } from "../db/app";
import { processSingleton } from "../singleton";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  expandRepoLocalPath,
  type RepoCreateBody,
  type RepoPatchBody,
} from "../schemas/repo";

export class RepoService {
  constructor(private readonly database: Database) {}

  expandLocalPath(raw: string | null | undefined): string | null {
    return expandRepoLocalPath(raw);
  }

  assertGitCheckout(localPath: string): void {
    if (!fs.existsSync(path.join(localPath, ".git"))) {
      throw new ValidationError(`Local path is not a git repository: ${localPath}`);
    }
  }

  listWithPathStatus(): Array<Repo & { local_path_exists: boolean }> {
    return this.database.listRepos().map((r) => ({
      ...r,
      local_path_exists: r.localPath ? fs.existsSync(path.join(r.localPath, ".git")) : false,
    }));
  }

  create(input: RepoCreateBody): Repo {
    const localPath = input.localPath ?? null;
    if (localPath) {
      this.assertGitCheckout(localPath);
    }
    return this.database.upsertRepo({
      name: input.name,
      cloud_url: input.cloudUrl,
      local_path: localPath,
      default_branch: input.defaultBranch ?? "main",
      use_worktrees: input.useWorktrees ?? true,
      install_command: input.installCommand ?? null,
      skip_install: Boolean(input.skipInstall),
      sync_paths: input.syncPaths ?? null,
      shared_dirs: input.sharedDirs ?? null,
      setup_command: input.setupCommand ?? null,
      worktree_timeout_ms: input.worktree_timeout_s ?? null,
    });
  }

  async update(id: string, patch: RepoPatchBody): Repo {
    const existing = await this.database.repoById(id);
    if (!existing) {
      throw new NotFoundError("repo", id);
    }
    const localPath = patch.localPath !== undefined ? patch.localPath : existing.localPath;
    if (localPath) {
      this.assertGitCheckout(localPath);
    }
    const trimOrKeep = (value: string | undefined, fallback: string | null): string | null => {
      if (value === undefined) return fallback;
      const trimmed = value.trim();
      return trimmed || null;
    };
    return this.database.upsertRepo({
      id,
      name: patch.name ?? existing.name,
      cloud_url: patch.cloudUrl ?? existing.cloudUrl,
      local_path: localPath || null,
      default_branch: patch.defaultBranch ?? existing.defaultBranch,
      use_worktrees:
        patch.useWorktrees !== undefined ? Boolean(patch.useWorktrees) : Boolean(existing.useWorktrees),
      install_command: trimOrKeep(patch.installCommand, existing.installCommand),
      skip_install:
        patch.skipInstall !== undefined ? Boolean(patch.skipInstall) : Boolean(existing.skipInstall),
      sync_paths: trimOrKeep(patch.syncPaths, existing.syncPaths),
      shared_dirs: trimOrKeep(patch.sharedDirs, existing.sharedDirs),
      setup_command: trimOrKeep(patch.setupCommand, existing.setupCommand),
      worktree_timeout_ms:
        patch.worktree_timeout_s !== undefined ? patch.worktree_timeout_s : existing.worktreeTimeoutMs,
    });
  }

  async delete(id: string): void {
    const existing = await this.database.repoById(id);
    if (!existing) {
      throw new NotFoundError("repo", id);
    }
    const inUse = await this.database.countFlowsByRepoId(id);
    if (inUse > 0) {
      throw new ConflictError(
        `Cannot delete repo: ${inUse} flow${inUse === 1 ? "" : "s"} still reference it`,
      );
    }
    await this.database.deleteRepo(id);
  }
}

export const repoService = processSingleton("repoService", () => new RepoService(db));
