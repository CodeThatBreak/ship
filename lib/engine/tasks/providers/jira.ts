import "server-only";

import { db } from "../../../db";
import type { Task } from "../../../db/rows";
import { jira, maskToken } from "../../../integrations/jira/service";
import {
  TaskProvider,
  type LiveTask,
  type LiveTaskFilters,
  type ProviderInstance,
  type TaskField,
  type TaskInstanceStore,
} from "../task-provider";

/**
 * The Jira task provider — moved verbatim from lib/integrations/jira.ts
 * (Phase 2): the transport (Basic auth + REST calls), ADF→text, PRD
 * extraction, figma-link scan, and the upsert-into-`tasks` materialization
 * live in one class so there is a single source of truth for jira task logic.
 *
 * Credentials come from the registered Jira instances (Settings →
 * Integrations → Task; DB-backed, no env fallback). Storage: tasks are NOT
 * synced into the DB for browsing — the tasks table fetches them live
 * (`liveFetch`, cached by /api/tasks/live). A row is only upserted via
 * `upsertLive` when a build starts (the flow engine needs the row for FK +
 * context hydration). Common columns carry the shared task contract;
 * jira-only payload (PRD text, figma links) lives in the `fields` JSON
 * column (`fields.prd`, `fields.figma_urls`) — the context hydration reads
 * them through the `Task` transform.
 */
export class JiraTaskProvider extends TaskProvider implements TaskInstanceStore {
  readonly kind = "jira";
  readonly label = "Jira";

  /** The {{task.*}} vocabulary this type exposes (Phase-3 lint vocabulary). */
  readonly contextFields: TaskField[] = [
    { key: "key", label: "Key", type: "string", required: true },
    { key: "summary", label: "Summary", type: "string", required: true },
    { key: "description", label: "Description", type: "string" },
    { key: "prd", label: "PRD", type: "string" },
    { key: "status", label: "Status", type: "string" },
    { key: "priority", label: "Priority", type: "string" },
    { key: "issue_type", label: "Issue type", type: "string" },
    { key: "figma_urls", label: "Figma designs", type: "array" },
    { key: "repo_url", label: "Repo URL", type: "string" },
  ];

  override configured(): boolean {
    return jira.configured();
  }

  /** The issue's external deep link (stored link wins; instance baseUrl as fallback). */
  externalUrl(task: Task): string {
    return task.externalUrl || `${jira.active()?.base_url ?? ""}/browse/${task.key}`;
  }

  /** ── instance registry (Settings → Integrations → Task) ────────────────── */

  override instanceStore(): TaskInstanceStore {
    return this;
  }

  instances(): ProviderInstance[] {
    return jira.listInstances().map(({ id, name, base_url, email, token }) => ({
      id, name, baseUrl: base_url, email, tokenMasked: maskToken(token),
    }));
  }

  addInstance(input: { name?: string | null; baseUrl: string; email?: string; token: string }): ProviderInstance {
    const inst = jira.addInstance({
      name: input.name ?? undefined,
      base_url: input.baseUrl,
      email: input.email ?? "",
      token: input.token,
    });
    return { id: inst.id, name: inst.name, baseUrl: inst.base_url, email: inst.email, tokenMasked: maskToken(inst.token) };
  }

  updateInstance(id: string, input: { name?: string | null; baseUrl?: string; email?: string; token?: string }): void {
    jira.updateInstance(id, input);
  }

  removeInstance(id: string): void {
    jira.deleteInstance(id);
  }

  async testInstance(
    id: string,
    input: { baseUrl?: string; email?: string; token?: string } = {}
  ): Promise<{ ok: boolean; detail: string }> {
    const existing = jira.listInstances().find((i) => i.id === id);
    if (!existing) throw new Error(`jira instance not found: ${id}`);
    return jira.testInstance(
      input.baseUrl ?? existing.base_url,
      input.email ?? existing.email,
      input.token || existing.token
    );
  }

  /**
   * Runtime fetch for the tasks table: composes the structured filters into
   * JQL. With no filters set this is the configured default ("assigned to
   * me, not done"). Nothing is written to the DB here.
   */
  async liveFetch(filters: LiveTaskFilters = {}): Promise<LiveTask[]> {
    const jql = this.jqlFor(filters);
    const issues = await this.fetchByJql(jql);
    const withParents = await this.expandParents(issues);
    return withParents.map((issue) => this.toLive(issue));
  }

  /**
   * Sub-task hierarchy: parents (stories/epics) are usually not assigned to
   * the current user, so they rarely match the filter themselves — without
   * them the table can't nest sub-tasks and stays flat. Fetch any missing
   * parents (and their ancestors, for sub-sub-task chains) by key and return
   * them alongside the matched issues as top-level container rows.
   */
  private async expandParents(issues: JiraIssue[]): Promise<JiraIssue[]> {
    const byKey = new Map(issues.map((i) => [i.key, i]));
    let frontier = issues
      .map((i) => i.parentKey)
      .filter((k) => k && !byKey.has(k));
    for (let depth = 0; depth < 5 && frontier.length; depth++) {
      const batch = [...new Set(frontier)].filter((k) => !byKey.has(k)).slice(0, 50);
      if (!batch.length) break;
      const parents = await this.fetchByJql(
        `key in (${batch.map((k) => JSON.stringify(k)).join(",")})`,
      );
      if (!parents.length) break;
      for (const p of parents) byKey.set(p.key, p);
      frontier = parents.map((p) => p.parentKey);
    }
    return [...byKey.values()];
  }

  /** Structured filters → JQL. No filters = your assigned, not-done issues. */
  private jqlFor({ assignee, statusCategory, text }: LiveTaskFilters): string {
    const parts: string[] = [
      assignee === "any" ? "assignee IS NOT EMPTY" : "assignee = currentUser()",
    ];
    if (!statusCategory && !text?.trim()) {
      // default view: only open work
      parts.push("statusCategory != Done");
    } else if (statusCategory) {
      parts.push(`statusCategory = ${JSON.stringify(statusCategory)}`);
    }
    if (text?.trim()) parts.push(`text ~ ${JSON.stringify(text.trim())}`);
    return `${parts.join(" AND ")} ORDER BY updated DESC`;
  }

  /** Store one live task in the `tasks` table (idempotent on key). */
  override upsertLive(task: LiveTask): string {
    const issue: JiraIssue = {
      id: task.id,
      key: task.key,
      summary: task.summary,
      description: task.description,
      status: task.status,
      issueType: task.issueType,
      priority: task.priority,
      prdText: typeof task.fields.prd === "string" ? task.fields.prd : "",
      figmaUrls: Array.isArray(task.fields.figma_urls)
        ? (task.fields.figma_urls as string[])
        : [],
      externalUrl: task.externalUrl,
      parentKey: task.parentKey,
      raw: task.raw,
    };
    return this.upsert(issue, db.now());
  }

  /** Provider-agnostic view of a normalized issue (no DB write). */
  private toLive(issue: JiraIssue): LiveTask {
    return {
      type: this.kind,
      id: issue.id,
      key: issue.key,
      summary: issue.summary,
      description: issue.description,
      status: issue.status,
      issueType: issue.issueType,
      priority: issue.priority,
      externalUrl: issue.externalUrl,
      parentKey: issue.parentKey,
      fields: { prd: issue.prdText, figma_urls: issue.figmaUrls },
      raw: issue.raw,
    };
  }

  // ── transport + normalization (single source of truth for jira logic) ────

  private headers(): HeadersInit {
    const inst = jira.active();
    return {
      Authorization: `Basic ${Buffer.from(`${inst?.email ?? ""}:${inst?.token ?? ""}`).toString("base64")}`,
      Accept: "application/json",
    };
  }

  /** Heuristically split a PRD out of the description. */
  private extractPrd(desc: string): string {
    const m = desc.match(/(?:^|\n)#+\s*(PRD|Product Requirements|Requirements)[\s\S]*/i);
    return m ? m[0].trim() : desc;
  }

  private normalize(issue: any): JiraIssue {
    const f = issue.fields ?? {};
    const descText =
      typeof f.description === "string" ? f.description : AdfRenderer.toText(f.description);
    const full = `${f.summary}\n${descText}`;
    const figma = Array.from(new Set(full.match(FIGMA_RE) ?? []));
    return {
      id: String(issue.id),
      key: issue.key,
      summary: f.summary ?? "",
      description: descText,
      status: f.status?.name ?? "",
      issueType: f.issuetype?.name ?? "",
      priority: f.priority?.name ?? "",
      prdText: this.extractPrd(descText || f.summary || ""),
      figmaUrls: figma,
      externalUrl: `${jira.active()?.base_url ?? ""}/browse/${issue.key}`,
      parentKey: f.parent?.key ?? "",
      raw: issue,
    };
  }

  private async fetchByJql(jql: string): Promise<JiraIssue[]> {
    const inst = jira.active();
    if (!inst) return [];
    // /rest/api/2/search was removed (Atlassian CHANGE-2046); use /rest/api/3/search/jql
    const url = `${inst.base_url}/rest/api/3/search/jql?jql=${encodeURIComponent(
      jql,
    )}&maxResults=50&fields=summary,description,status,issuetype,priority,parent`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Jira search failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return (data.issues ?? []).map((i: any) => this.normalize(i));
  }

  /** Upsert one issue as a task row (idempotent on key) and return its row id. */
  private upsert(issue: JiraIssue, ts: string): string {
    const fields = JSON.stringify({ prd: issue.prdText, figma_urls: issue.figmaUrls });
    const existing = db.get<{ id: string }>(`SELECT id FROM tasks WHERE key=?`, issue.key);
    if (existing) {
      db.run(
        `UPDATE tasks SET summary=?,description=?,status=?,issue_type=?,priority=?,external_url=?,parent_key=?,raw=?,fields=?,synced_at=? WHERE key=?`,
        issue.summary, issue.description, issue.status, issue.issueType, issue.priority,
        issue.externalUrl, issue.parentKey || null,
        JSON.stringify(issue.raw), fields, ts, issue.key
      );
      return existing.id;
    }
    db.run(
      `INSERT INTO tasks (id,key,summary,description,status,issue_type,priority,repo_url,parent_key,external_url,raw,fields,type,synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'jira',?)`,
      issue.id, issue.key, issue.summary, issue.description, issue.status, issue.issueType,
      issue.priority, null,
      issue.parentKey || null, issue.externalUrl, JSON.stringify(issue.raw), fields, ts
    );
    return issue.id;
  }
}

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  issueType: string;
  priority: string;
  prdText: string;
  figmaUrls: string[];
  externalUrl: string;
  /** Parent issue key when this is a sub-task (e.g. a story's child). */
  parentKey: string;
  raw: any;
}

const FIGMA_RE = /https?:\/\/(?:www\.)?figma\.com\/[^\s)\]"']+/g;

/** Flatten Atlassian Document Format into plain text. */
class AdfRenderer {
  static toText(node: any): string {
    if (!node) return "";
    if (typeof node === "string") return node;
    let out = "";
    if (node.text) out += node.text;
    if (Array.isArray(node.content)) {
      const parts = node.content.map(AdfRenderer.toText);
      const joined = parts.join("");
      out += joined;
      if (["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(node.type)) out += "\n";
      if (node.type === "listItem") out = "• " + out;
    }
    return out;
  }
}
