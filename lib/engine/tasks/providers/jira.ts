import { config } from "../../../config";
import { db } from "../../../db";
import type { Task } from "../../../db/rows";
import { TaskProvider, type TaskField } from "../task-provider";

/**
 * The Jira task provider — moved verbatim from lib/integrations/jira.ts
 * (Phase 2): the transport (Basic auth + REST calls), ADF→text, PRD
 * extraction, figma-link scan, and the upsert-into-`tasks` sync now live in
 * one class so there is a single source of truth for jira task logic.
 *
 * Storage: common columns carry the shared task contract; jira-only payload
 * (PRD text, figma links) lives in the `fields` JSON column
 * (`fields.prd`, `fields.figma_urls`) — the context hydration reads them
 * through the `Task` transform.
 */
export class JiraTaskProvider extends TaskProvider {
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
    return config.jira.configured();
  }

  /** The issue's external deep link (stored link wins; env baseUrl as fallback). */
  externalUrl(task: Task): string {
    return task.externalUrl || `${config.jira.baseUrl()}/browse/${task.key}`;
  }

  /** Pull every issue matched by the configured JQL into the tasks table. */
  async sync(): Promise<string[]> {
    const issues = await this.fetchMyIssues();
    const ts = db.now();
    return issues.map((issue) => this.upsert(issue, ts));
  }

  // ── transport + normalization (single source of truth for jira logic) ────

  private headers(): HeadersInit {
    return {
      Authorization: `Basic ${Buffer.from(`${config.jira.email()}:${config.jira.token()}`).toString("base64")}`,
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
      externalUrl: `${config.jira.baseUrl()}/browse/${issue.key}`,
      parentKey: f.parent?.key ?? "",
      raw: issue,
    };
  }

  private async fetchMyIssues(): Promise<JiraIssue[]> {
    if (!this.configured()) return [];
    // /rest/api/2/search was removed (Atlassian CHANGE-2046); use /rest/api/3/search/jql
    const url = `${config.jira.baseUrl()}/rest/api/3/search/jql?jql=${encodeURIComponent(
      config.jira.jql()
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
      const joined = parts.join(node.type === "paragraph" || node.type === "heading" ? "" : "");
      out += joined;
      if (["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(node.type)) out += "\n";
      if (node.type === "listItem") out = "• " + out;
    }
    return out;
  }
}
