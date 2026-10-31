import "server-only";

import fs from "fs";
import path from "path";
import type { Database, Repo } from "../db";
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
      local_path_exists: r.local_path ? fs.existsSync(path.join(r.local_path, ".git")) : false,
    }));
  }

  create(input: RepoCreateBody): Repo {
    const localPath = input.local_path ?? null;
    if (localPath) {
      this.assertGitCheckout(localPath);
    }
    return this.database.upsertRepo({
      name: input.name,
      cloud_url: input.cloud_url,
      local_path: localPath,
      default_branch: input.default_branch ?? "main",
      install_command: input.install_command ?? null,
      skip_install: Boolean(input.skip_install),
      sync_paths: input.sync_paths ?? null,
      shared_dirs: input.shared_dirs ?? null,
      setup_command: input.setup_command ?? null,
      worktree_timeout_ms: input.worktree_timeout_s ?? null,
    });
  }

  update(id: string, patch: RepoPatchBody): Repo {
    const existing = this.database.repoById(id);
    if (!existing) {
      throw new NotFoundError("repo", id);
    }
    const localPath = patch.local_path !== undefined ? patch.local_path : existing.local_path;
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
      cloud_url: patch.cloud_url ?? existing.cloud_url,
      local_path: localPath || null,
      default_branch: patch.default_branch ?? existing.default_branch,
      install_command: trimOrKeep(patch.install_command, existing.install_command),
      skip_install:
        patch.skip_install !== undefined ? Boolean(patch.skip_install) : Boolean(existing.skip_install),
      sync_paths: trimOrKeep(patch.sync_paths, existing.sync_paths),
      shared_dirs: trimOrKeep(patch.shared_dirs, existing.shared_dirs),
      setup_command: trimOrKeep(patch.setup_command, existing.setup_command),
      worktree_timeout_ms:
        patch.worktree_timeout_s !== undefined ? patch.worktree_timeout_s : existing.worktree_timeout_ms,
    });
  }

  delete(id: string): void {
    const existing = this.database.repoById(id);
    if (!existing) {
      throw new NotFoundError("repo", id);
    }
    const inUse = this.database.countFlowsByRepoId(id);
    if (inUse > 0) {
      throw new ConflictError(
        `Cannot delete repo: ${inUse} flow${inUse === 1 ? "" : "s"} still reference it`,
      );
    }
    this.database.deleteRepo(id);
  }
}
