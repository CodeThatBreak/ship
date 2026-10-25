import { db } from "../../db";

export interface JiraInstance {
  id: string;
  name: string | null;
  base_url: string;
  email: string;
  token: string;
}

/** Masked token for the settings UI (never the real value). */
export function maskToken(t: string): string {
  if (!t) return "";
  if (t.length <= 4) return "••••";
  return `••••${t.slice(-4)}`;
}

/**
 * Jira integration: registry of configured instances (DB-backed, managed from
 * Settings → Integrations → Task) plus the credential checks the task
 * provider and the settings API go through.
 */
export class JiraService {
  // ── instance registry ────────────────────────────────────────────────────
  listInstances(): JiraInstance[] {
    return db.all<JiraInstance>(`SELECT * FROM jira_instances ORDER BY base_url`);
  }

  addInstance(input: { name?: string | null; base_url: string; email: string; token: string }): JiraInstance {
    const baseUrl = input.base_url.trim().replace(/\/+$/, "");
    const id = db.uid("jri_");
    db.run(
      `INSERT INTO jira_instances (id,name,base_url,email,token,created_at) VALUES (?,?,?,?,?,?)`,
      id, input.name ?? null, baseUrl, input.email.trim(), input.token, db.now()
    );
    return { id, name: input.name ?? null, base_url: baseUrl, email: input.email.trim(), token: input.token };
  }

  /** Update by id; a blank/absent token or email keeps the stored one. */
  updateInstance(
    id: string,
    input: { name?: string | null; base_url?: string; email?: string; token?: string }
  ): void {
    const existing = this.listInstances().find((i) => i.id === id);
    if (!existing) throw new Error(`jira instance not found: ${id}`);
    db.run(
      `UPDATE jira_instances SET name=?, base_url=?, email=?, token=? WHERE id=?`,
      input.name ?? existing.name,
      (input.base_url ?? existing.base_url).trim().replace(/\/+$/, ""),
      (input.email ?? existing.email).trim(),
      input.token || existing.token,
      id
    );
  }

  deleteInstance(id: string): void {
    db.run(`DELETE FROM jira_instances WHERE id=?`, id);
  }

  /**
   * The instance the task provider talks to. Tasks don't carry a host, so the
   * single-tenant app resolves to the first registered instance.
   */
  active(): JiraInstance | undefined {
    return this.listInstances()[0];
  }

  /** True when at least one instance is registered. */
  configured(): boolean {
    return this.listInstances().length > 0;
  }

  /** Quick reachability/auth check used by the settings UI. */
  async testInstance(baseUrl: string, email: string, token: string): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetch(
        `${baseUrl.replace(/\/+$/, "")}/rest/api/3/myself`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
            Accept: "application/json",
          },
        }
      );
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const user = (await res.json()) as any;
      return { ok: true, detail: `Authenticated as ${user.displayName ?? user.name ?? "user"}` };
    } catch (e: any) {
      return { ok: false, detail: e?.message ?? String(e) };
    }
  }
}

/** Shared Jira integration instance. */
export const jira = new JiraService();
