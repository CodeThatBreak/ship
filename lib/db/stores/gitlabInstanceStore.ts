import "server-only";

import { GitLabInstanceRow, type GitLabInstance } from "../rows";
import type { Database } from "../database";
import type { RowGateway } from "../rows";
import type { IntegrationSecretStore } from "../integrationSecretStore";

export type GitLabInstanceMeta = Omit<GitLabInstance, "token">;

export class GitLabInstanceStore {
  constructor(
    private readonly db: Database,
    private readonly rows: RowGateway,
    private readonly secrets: IntegrationSecretStore,
  ) {}

  listMeta(): Promise<GitLabInstanceMeta[]> {
    return this.rows.all(
      GitLabInstanceRow.omit({ token: true }),
      `SELECT id, name, base_url AS "baseUrl", created_at AS "createdAt" FROM gitlab_instances ORDER BY base_url`,
    );
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
    const createdAt = this.db.now();
    const sealed = this.secrets.seal(input.token);
    await this.db.run(
      `INSERT INTO gitlab_instances (id,name,base_url,token,created_at) VALUES ($1,$2,$3,$4,$5)`,
      id,
      input.name ?? null,
      baseUrl,
      sealed,
      createdAt,
    );
    return { id, name: input.name ?? null, baseUrl, token: input.token, createdAt };
  }

  async update(id: string, input: { name?: string | null; baseUrl: string; token: string }): Promise<void> {
    await this.db.run(
      `UPDATE gitlab_instances SET name=$1, base_url=$2, token=$3 WHERE id=$4`,
      input.name ?? null,
      input.baseUrl.trim().replace(/\/+$/, ""),
      this.secrets.seal(input.token),
      id,
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM gitlab_instances WHERE id=$1`, id);
  }
}
