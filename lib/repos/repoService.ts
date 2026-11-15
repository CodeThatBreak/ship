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

  async listWithPathStatus(): Promise<Array<Repo & { localPathExists: boolean }>> {
    const repos = await this.database.listRepos();
    return repos.map((r) => ({
      ...r,
      localPathExists: r.localPath ? fs.existsSync(path.join(r.localPath, ".git")) : false,
    }));
  }

  async create(input: RepoCreateBody): Promise<Repo> {
    const localPath = input.local_path ?? null;
    if (localPath) {
      this.assertGitCheckout(localPath);
    }
    return this.database.upsertRepo({
      name: input.name,
      cloudUrl: input.cloud_url,
      localPath,
      defaultBranch: input.default_branch ?? "main",
      useWorktrees: input.use_worktrees ?? true,
      installCommand: input.install_command ?? null,
      skipInstall: Boolean(input.skip_install),
      syncPaths: input.sync_paths ?? null,
      sharedDirs: input.shared_dirs ?? null,
      setupCommand: input.setup_command ?? null,
      worktreeTimeoutMs: input.worktree_timeout_s ?? null,
    });
  }

  async update(id: string, patch: RepoPatchBody): Promise<Repo> {
    const existing = await this.database.repoById(id);
    if (!existing) {
      throw new NotFoundError("repo", id);
    }
    const localPath = patch.local_path !== undefined ? patch.local_path : existing.localPath;
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
      cloudUrl: patch.cloud_url ?? existing.cloudUrl,
      localPath: localPath || null,
      defaultBranch: patch.default_branch ?? existing.defaultBranch,
      useWorktrees:
        patch.use_worktrees !== undefined ? Boolean(patch.use_worktrees) : Boolean(existing.useWorktrees),
      installCommand: trimOrKeep(patch.install_command, existing.installCommand),
      skipInstall:
        patch.skip_install !== undefined ? Boolean(patch.skip_install) : Boolean(existing.skipInstall),
      syncPaths: trimOrKeep(patch.sync_paths, existing.syncPaths),
      sharedDirs: trimOrKeep(patch.shared_dirs, existing.sharedDirs),
      setupCommand: trimOrKeep(patch.setup_command, existing.setupCommand),
      worktreeTimeoutMs:
        patch.worktree_timeout_s !== undefined ? patch.worktree_timeout_s : existing.worktreeTimeoutMs,
    });
  }

  async delete(id: string): Promise<void> {
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
