import "server-only";

import fs from "fs";
import path from "path";
import { db, type Database, type Repo } from "../db/app";
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
    const localPath = input.localPath ?? null;
    if (localPath) {
      this.assertGitCheckout(localPath);
    }
    return this.database.upsertRepo({
      name: input.name,
      cloudUrl: input.cloudUrl,
      localPath,
      defaultBranch: input.defaultBranch ?? "main",
      useWorktrees: input.useWorktrees ?? true,
      installCommand: input.installCommand ?? null,
      skipInstall: Boolean(input.skipInstall),
      syncPaths: input.syncPaths ?? null,
      sharedDirs: input.sharedDirs ?? null,
      setupCommand: input.setupCommand ?? null,
      worktreeTimeoutMs: input.worktreeTimeoutS ?? null,
    });
  }

  async update(id: string, patch: RepoPatchBody): Promise<Repo> {
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
      cloudUrl: patch.cloudUrl ?? existing.cloudUrl,
      localPath: localPath || null,
      defaultBranch: patch.defaultBranch ?? existing.defaultBranch,
      useWorktrees:
        patch.useWorktrees !== undefined ? Boolean(patch.useWorktrees) : Boolean(existing.useWorktrees),
      installCommand: trimOrKeep(patch.installCommand, existing.installCommand),
      skipInstall:
        patch.skipInstall !== undefined ? Boolean(patch.skipInstall) : Boolean(existing.skipInstall),
      syncPaths: trimOrKeep(patch.syncPaths, existing.syncPaths),
      sharedDirs: trimOrKeep(patch.sharedDirs, existing.sharedDirs),
      setupCommand: trimOrKeep(patch.setupCommand, existing.setupCommand),
      worktreeTimeoutMs:
        patch.worktreeTimeoutS !== undefined ? patch.worktreeTimeoutS : existing.worktreeTimeoutMs,
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

/** Shared repo service (stateless, db-injected — decision Q9, plain module const). */
export const repoService = new RepoService(db);
