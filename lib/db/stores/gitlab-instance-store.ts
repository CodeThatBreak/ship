import "server-only";

import { GitLabInstanceRow, type GitLabInstance } from "../rows";
import type { Database } from "../database";
import type { RowGateway } from "../rows";

export class GitLabInstanceStore {
  constructor(
    private readonly db: Database,
    private readonly rows: RowGateway,
  ) {}

  list(): GitLabInstance[] {
    return this.rows.all(GitLabInstanceRow, `SELECT * FROM gitlab_instances ORDER BY base_url`);
  }

  add(input: { name?: string | null; base_url: string; token: string }): GitLabInstance {
    const baseUrl = input.base_url.trim().replace(/\/+$/, "");
    const id = this.db.uid("gli_");
    const createdAt = this.db.now();
    this.db.run(
      `INSERT INTO gitlab_instances (id,name,base_url,token,created_at) VALUES (?,?,?,?,?)`,
      id,
      input.name ?? null,
      baseUrl,
      input.token,
      createdAt,
    );
    return { id, name: input.name ?? null, base_url: baseUrl, token: input.token, created_at: createdAt };
  }

  update(id: string, input: { name?: string | null; base_url: string; token: string }): void {
    this.db.run(
      `UPDATE gitlab_instances SET name=?, base_url=?, token=? WHERE id=?`,
      input.name ?? null,
      input.base_url.trim().replace(/\/+$/, ""),
      input.token,
      id,
    );
  }

  delete(id: string): void {
    this.db.run(`DELETE FROM gitlab_instances WHERE id=?`, id);
  }
}
