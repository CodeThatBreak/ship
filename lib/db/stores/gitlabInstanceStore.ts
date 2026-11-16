import "server-only";

import { GitLabInstanceRow, type GitLabInstance } from "../rows";
import type { Database } from "../database";
import type { IntegrationSecretStore } from "../integrationSecretStore";

export type GitLabInstanceMeta = Omit<GitLabInstance, "token">;

const metaSchema = GitLabInstanceRow.omit({ token: true });

/** Self-hosted GitLab instances: repo host → API token (sealed at rest). */
export class GitLabInstanceStore {
  constructor(
    private readonly db: Database,
    private readonly secrets: IntegrationSecretStore,
  ) {}

  async listMeta(): Promise<GitLabInstanceMeta[]> {
    const rows = await this.db.prisma.gitlabInstance.findMany({
      orderBy: { baseUrl: "asc" },
      select: { id: true, name: true, baseUrl: true, createdAt: true },
    });
    const decoded: GitLabInstanceMeta[] = [];
    for (const raw of rows) {
      const result = metaSchema.safeParse(raw);
      if (result.success) decoded.push(result.data);
    }
    return decoded;
  }

  async get(id: string): Promise<GitLabInstance | undefined> {
    const metas = await this.listMeta();
    const meta = metas.find((row) => row.id === id);
    if (!meta) return undefined;
    return { ...meta, token: await this.secrets.readGitLabToken(id) };
  }

  readToken(id: string): Promise<string> {
    return this.secrets.readGitLabToken(id);
  }

  async add(input: { name?: string | null; baseUrl: string; token: string }): Promise<GitLabInstance> {
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
    const id = this.db.uid("gli_");
    // one Date for the row and the return value — a second `new Date()` can
    // land a millisecond later and disagree with what listMeta reads back
    const createdAt = new Date();
    const sealed = this.secrets.seal(input.token);
    await this.db.prisma.gitlabInstance.create({
      data: { id, name: input.name ?? null, baseUrl, token: sealed, createdAt },
    });
    return { id, name: input.name ?? null, baseUrl, token: input.token, createdAt: createdAt.toISOString() };
  }

  async update(id: string, input: { name?: string | null; baseUrl: string; token: string }): Promise<void> {
    await this.db.prisma.gitlabInstance.update({
      where: { id },
      data: {
        name: input.name ?? null,
        baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
        token: this.secrets.seal(input.token),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.prisma.gitlabInstance.deleteMany({ where: { id } });
  }
}
