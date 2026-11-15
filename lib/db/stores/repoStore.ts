import "server-only";

import { NotFoundError } from "../../errors";
import { RepoRow, type Repo } from "../rows";
import type { Database } from "../database";

const toRepo = (raw: unknown): Repo | undefined => {
  const result = RepoRow.safeParse(raw);
  return result.success ? result.data : undefined;
};

/** Repo registry: local path ↔ cloud URL (per-domain GitLab) for each repo. */
export class RepoStore {
  constructor(private readonly db: Database) {}

  async listRepos(): Promise<Repo[]> {
    const rows = await this.db.prisma.repo.findMany({ orderBy: { name: "asc" } });
    return rows.map(toRepo).filter((r): r is Repo => r !== undefined);
  }

  async repoById(id: string): Promise<Repo | undefined> {
    const row = await this.db.prisma.repo.findUnique({ where: { id } });
    return row ? toRepo(row) : undefined;
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
    const cloudUrl = this.normalizeRepoUrl(input.cloudUrl);
    const data = {
      name: input.name,
      cloudUrl,
      localPath: input.localPath ?? null,
      defaultBranch: input.defaultBranch ?? "main",
      useWorktrees: input.useWorktrees ?? true,
      installCommand: input.installCommand ?? null,
      skipInstall: input.skipInstall ?? false,
      syncPaths: input.syncPaths ?? null,
      sharedDirs: input.sharedDirs ?? null,
      setupCommand: input.setupCommand ?? null,
      worktreeTimeoutMs: input.worktreeTimeoutMs ?? null,
    };
    if (input.id) {
      const res = await this.db.prisma.repo.updateMany({
        where: { id: input.id },
        data: { ...data, updatedAt: new Date() },
      });
      if (res.count === 0) throw new NotFoundError("repo", input.id);
      const repo = await this.repoById(input.id);
      if (!repo) throw new NotFoundError("repo", input.id);
      return repo;
    }
    const id = this.db.uid("repo_");
    const ts = new Date();
    await this.db.prisma.repo.create({ data: { id, ...data, createdAt: ts, updatedAt: ts } });
    const repo = await this.repoById(id);
    if (!repo) throw new NotFoundError("repo", id);
    return repo;
  }

  async deleteRepo(id: string): Promise<void> {
    await this.db.prisma.repo.deleteMany({ where: { id } });
  }

  async countFlowsByRepoId(repoId: string): Promise<number> {
    return this.db.prisma.flow.count({ where: { repoId } });
  }
}
