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

  listMeta(): JiraInstanceMeta[] {
    return this.rows.all(
      JiraInstanceRow.omit({ token: true }),
      `SELECT id, name, base_url, email, created_at FROM jira_instances ORDER BY base_url`,
    );
  }

  get(id: string): JiraInstance | undefined {
    const meta = this.listMeta().find((row) => row.id === id);
    if (!meta) return undefined;
    return { ...meta, token: this.secrets.readJiraToken(id) };
  }

  readToken(id: string): string {
    return this.secrets.readJiraToken(id);
  }

  add(input: { name?: string | null; base_url: string; email: string; token: string }): JiraInstance {
    const baseUrl = input.base_url.trim().replace(/\/+$/, "");
    const id = this.db.uid("jri_");
    const createdAt = this.db.now();
    const sealed = this.secrets.seal(input.token);
    this.db.run(
      `INSERT INTO jira_instances (id,name,base_url,email,token,created_at) VALUES (?,?,?,?,?,?)`,
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
      base_url: baseUrl,
      email: input.email.trim(),
      token: input.token,
      created_at: createdAt,
    };
  }

  update(
    id: string,
    input: { name?: string | null; base_url?: string; email?: string; token?: string },
    existing: JiraInstance,
  ): void {
    const token = input.token || existing.token;
    this.db.run(
      `UPDATE jira_instances SET name=?, base_url=?, email=?, token=? WHERE id=?`,
      input.name ?? existing.name,
      (input.base_url ?? existing.base_url).trim().replace(/\/+$/, ""),
      (input.email ?? existing.email).trim(),
      this.secrets.seal(token),
      id,
    );
  }

  delete(id: string): void {
    this.db.run(`DELETE FROM jira_instances WHERE id=?`, id);
  }
}
