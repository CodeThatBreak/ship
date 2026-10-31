import "server-only";

import { JiraInstanceRow, type JiraInstance } from "../rows";
import type { Database } from "../database";
import type { RowGateway } from "../rows";

export class JiraInstanceStore {
  constructor(
    private readonly db: Database,
    private readonly rows: RowGateway,
  ) {}

  list(): JiraInstance[] {
    return this.rows.all(JiraInstanceRow, `SELECT * FROM jira_instances ORDER BY base_url`);
  }

  add(input: { name?: string | null; base_url: string; email: string; token: string }): JiraInstance {
    const baseUrl = input.base_url.trim().replace(/\/+$/, "");
    const id = this.db.uid("jri_");
    const createdAt = this.db.now();
    this.db.run(
      `INSERT INTO jira_instances (id,name,base_url,email,token,created_at) VALUES (?,?,?,?,?,?)`,
      id,
      input.name ?? null,
      baseUrl,
      input.email.trim(),
      input.token,
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
    this.db.run(
      `UPDATE jira_instances SET name=?, base_url=?, email=?, token=? WHERE id=?`,
      input.name ?? existing.name,
      (input.base_url ?? existing.base_url).trim().replace(/\/+$/, ""),
      (input.email ?? existing.email).trim(),
      input.token || existing.token,
      id,
    );
  }

  delete(id: string): void {
    this.db.run(`DELETE FROM jira_instances WHERE id=?`, id);
  }
}
