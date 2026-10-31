import "server-only";

import { NotFoundError } from "../../errors";
import { RepoRow, type Repo } from "../rows";
import type { Database } from "../database";
import type { RowGateway } from "../rows";

export class RepoStore {
  constructor(
    private readonly db: Database,
    private readonly rows: RowGateway,
  ) {}

  listRepos(): Repo[] {
    return this.rows.all(RepoRow, `SELECT * FROM repos ORDER BY name`);
  }

  repoById(id: string): Repo | undefined {
    return this.rows.get(RepoRow, `SELECT * FROM repos WHERE id=?`, id);
  }

  repoByCloudUrl(cloudUrl: string): Repo | undefined {
    const norm = this.normalizeRepoUrl(cloudUrl);
    return this.listRepos().find((r) => this.normalizeRepoUrl(r.cloud_url) === norm);
  }

  normalizeRepoUrl(url: string): string {
    return url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  }

  upsertRepo(input: {
    id?: string;
    name: string;
    cloud_url: string;
    local_path?: string | null;
    default_branch?: string;
    install_command?: string | null;
    skip_install?: boolean;
    sync_paths?: string | null;
    shared_dirs?: string | null;
    setup_command?: string | null;
    worktree_timeout_ms?: number | null;
  }): Repo {
    const ts = this.db.now();
    const cloudUrl = this.normalizeRepoUrl(input.cloud_url);
    if (input.id) {
      const changes = this.db.run(
        `UPDATE repos SET name=?, cloud_url=?, local_path=?, default_branch=?,
         install_command=?, skip_install=?, sync_paths=?, shared_dirs=?, setup_command=?, worktree_timeout_ms=?, updated_at=? WHERE id=?`,
        input.name,
        cloudUrl,
        input.local_path ?? null,
        input.default_branch ?? "main",
        input.install_command ?? null,
        input.skip_install ? 1 : 0,
        input.sync_paths ?? null,
        input.shared_dirs ?? null,
        input.setup_command ?? null,
        input.worktree_timeout_ms ?? null,
        ts,
        input.id,
      ).changes;
      if (changes === 0) throw new NotFoundError("repo", input.id);
      const repo = this.repoById(input.id);
      if (!repo) throw new NotFoundError("repo", input.id);
      return repo;
    }
    const id = this.db.uid("repo_");
    this.db.run(
      `INSERT INTO repos (id,name,cloud_url,local_path,default_branch,install_command,skip_install,sync_paths,shared_dirs,setup_command,worktree_timeout_ms,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      input.name,
      cloudUrl,
      input.local_path ?? null,
      input.default_branch ?? "main",
      input.install_command ?? null,
      input.skip_install ? 1 : 0,
      input.sync_paths ?? null,
      input.shared_dirs ?? null,
      input.setup_command ?? null,
      input.worktree_timeout_ms ?? null,
      ts,
      ts,
    );
    const repo = this.repoById(id);
    if (!repo) throw new NotFoundError("repo", id);
    return repo;
  }

  deleteRepo(id: string): void {
    this.db.run(`DELETE FROM repos WHERE id=?`, id);
  }

  countFlowsByRepoId(repoId: string): number {
    const row = this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM flows WHERE repo_id=?`,
      repoId,
    );
    return row?.n ?? 0;
  }
}
