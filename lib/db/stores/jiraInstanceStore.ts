import "server-only";

import { JiraInstanceRow, type JiraInstance } from "../rows";
import type { Database } from "../database";
import type { RowGateway } from "../rows";
import type { IntegrationSecretStore } from "../integrationSecretStore";

export type JiraInstanceMeta = Omit<JiraInstance, "token">;

export class JiraInstanceStore {
  constructor(
    private readonly db: Database,
    private readonly rows: RowGateway,
    private readonly secrets: IntegrationSecretStore,
  ) {}

  listMeta(): Promise<JiraInstanceMeta[]> {
    return this.rows.all(
      JiraInstanceRow.omit({ token: true }),
      `SELECT id, name, base_url AS "baseUrl", email, created_at AS "createdAt" FROM jira_instances ORDER BY base_url`,
    );
  }

  async get(id: string): Promise<JiraInstance | undefined> {
    const metas = await this.listMeta();
    const meta = metas.find((row) => row.id === id);
    if (!meta) return undefined;
    return { ...meta, token: await this.secrets.readJiraToken(id) };
  }

  readToken(id: string): Promise<string> {
    return this.secrets.readJiraToken(id);
  }

  async add(input: { name?: string | null; baseUrl: string; email: string; token: string }): Promise<JiraInstance> {
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
    const id = this.db.uid("jri_");
    const createdAt = this.db.now();
    const sealed = this.secrets.seal(input.token);
    await this.db.run(
      `INSERT INTO jira_instances (id,name,base_url,email,token,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      id,
      input.name ?? null,
      baseUrl,
      input.email.trim(),
      sealed,
      createdAt,
    );
    return {
      id,
      name: input.name ?? null,
      baseUrl,
      email: input.email.trim(),
      token: input.token,
      createdAt,
    };
  }

  async update(
    id: string,
    input: { name?: string | null; baseUrl?: string; email?: string; token?: string },
    existing: JiraInstance,
  ): Promise<void> {
    const token = input.token || existing.token;
    await this.db.run(
      `UPDATE jira_instances SET name=$1, base_url=$2, email=$3, token=$4 WHERE id=$5`,
      input.name ?? existing.name,
      (input.baseUrl ?? existing.baseUrl).trim().replace(/\/+$/, ""),
      (input.email ?? existing.email).trim(),
      this.secrets.seal(token),
      id,
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM jira_instances WHERE id=$1`, id);
  }
}
