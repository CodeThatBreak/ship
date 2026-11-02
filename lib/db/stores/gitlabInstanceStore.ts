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

  listMeta(): GitLabInstanceMeta[] {
    return this.rows.all(
      GitLabInstanceRow.omit({ token: true }),
      `SELECT id, name, base_url, created_at FROM gitlab_instances ORDER BY base_url`,
    );
  }

  get(id: string): GitLabInstance | undefined {
    const meta = this.listMeta().find((row) => row.id === id);
    if (!meta) return undefined;
    return { ...meta, token: this.secrets.readGitLabToken(id) };
  }

  readToken(id: string): string {
    return this.secrets.readGitLabToken(id);
  }

  add(input: { name?: string | null; base_url: string; token: string }): GitLabInstance {
    const baseUrl = input.base_url.trim().replace(/\/+$/, "");
    const id = this.db.uid("gli_");
    const createdAt = this.db.now();
    const sealed = this.secrets.seal(input.token);
    this.db.run(
      `INSERT INTO gitlab_instances (id,name,base_url,token,created_at) VALUES (?,?,?,?,?)`,
      id,
      input.name ?? null,
      baseUrl,
      sealed,
      createdAt,
    );
    return { id, name: input.name ?? null, base_url: baseUrl, token: input.token, created_at: createdAt };
  }

  update(id: string, input: { name?: string | null; base_url: string; token: string }): void {
    this.db.run(
      `UPDATE gitlab_instances SET name=?, base_url=?, token=? WHERE id=?`,
      input.name ?? null,
      input.base_url.trim().replace(/\/+$/, ""),
      this.secrets.seal(input.token),
      id,
    );
  }

  delete(id: string): void {
    this.db.run(`DELETE FROM gitlab_instances WHERE id=?`, id);
  }
}
