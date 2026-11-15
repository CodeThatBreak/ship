import "server-only";

import { NotFoundError } from "../../errors";
import { RepoRow, type Repo } from "../rows";
import type { Database } from "../database";
import type { RowGateway } from "../rows";

const REPO_SELECT = `SELECT id, name, cloud_url AS "cloudUrl", local_path AS "localPath",
       default_branch AS "defaultBranch", use_worktrees AS "useWorktrees",
       install_command AS "installCommand", skip_install AS "skipInstall",
       sync_paths AS "syncPaths", shared_dirs AS "sharedDirs",
       setup_command AS "setupCommand", worktree_timeout_ms AS "worktreeTimeoutMs",
       created_at AS "createdAt", updated_at AS "updatedAt"
       FROM repos`;

export class RepoStore {
  constructor(
    private readonly db: Database,
    private readonly rows: RowGateway,
  ) {}

  listRepos(): Promise<Repo[]> {
    return this.rows.all(RepoRow, `${REPO_SELECT} ORDER BY name`);
  }

  repoById(id: string): Promise<Repo | undefined> {
    return this.rows.get(RepoRow, `${REPO_SELECT} WHERE id=$1`, id);
  }

  async repoByCloudUrl(cloudUrl: string): Promise<Repo | undefined> {
    const norm = this.normalizeRepoUrl(cloudUrl);
    const repos = await this.listRepos();
    return repos.find((r) => this.normalizeRepoUrl(r.cloudUrl) === norm);
  }

  normalizeRepoUrl(url: string): string {
    return url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  }

  async upsertRepo(input: {
    id?: string;
    name: string;
    cloudUrl: string;
    localPath?: string | null;
    defaultBranch?: string;
    useWorktrees?: boolean;
    installCommand?: string | null;
    skipInstall?: boolean;
    syncPaths?: string | null;
    sharedDirs?: string | null;
    setupCommand?: string | null;
    worktreeTimeoutMs?: number | null;
  }): Promise<Repo> {
    const ts = this.db.now();
    const cloudUrl = this.normalizeRepoUrl(input.cloudUrl);
    if (input.id) {
      const changes = await this.db.run(
        `UPDATE repos SET name=$1, cloud_url=$2, local_path=$3, default_branch=$4, use_worktrees=$5,
         install_command=$6, skip_install=$7, sync_paths=$8, shared_dirs=$9, setup_command=$10,
         worktree_timeout_ms=$11, updated_at=$12 WHERE id=$13`,
        input.name,
        cloudUrl,
        input.localPath ?? null,
        input.defaultBranch ?? "main",
        input.useWorktrees ?? true,
        input.installCommand ?? null,
        input.skipInstall ?? false,
        input.syncPaths ?? null,
        input.sharedDirs ?? null,
        input.setupCommand ?? null,
        input.worktreeTimeoutMs ?? null,
        ts,
        input.id,
      );
      if (changes === 0) throw new NotFoundError("repo", input.id);
      const repo = await this.repoById(input.id);
      if (!repo) throw new NotFoundError("repo", input.id);
      return repo;
    }
    const id = this.db.uid("repo_");
    await this.db.run(
      `INSERT INTO repos (id,name,cloud_url,local_path,default_branch,use_worktrees,install_command,skip_install,sync_paths,shared_dirs,setup_command,worktree_timeout_ms,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      id,
      input.name,
      cloudUrl,
      input.localPath ?? null,
      input.defaultBranch ?? "main",
      input.useWorktrees ?? true,
      input.installCommand ?? null,
      input.skipInstall ?? false,
      input.syncPaths ?? null,
      input.sharedDirs ?? null,
      input.setupCommand ?? null,
      input.worktreeTimeoutMs ?? null,
      ts,
      ts,
    );
    const repo = await this.repoById(id);
    if (!repo) throw new NotFoundError("repo", id);
    return repo;
  }

  async deleteRepo(id: string): Promise<void> {
    await this.db.run(`DELETE FROM repos WHERE id=$1`, id);
  }

  async countFlowsByRepoId(repoId: string): Promise<number> {
    const row = await this.db.get<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM flows WHERE repo_id=$1`,
      repoId,
    );
    return row?.n ?? 0;
  }
}
