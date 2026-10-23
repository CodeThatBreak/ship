import { config } from "../config";

export interface JiraTicket {
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  issueType: string;
  priority: string;
  prdText: string;
  figmaUrls: string[];
  jiraUrl: string;
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

/** Jira REST API client (Basic auth via email + API token). */
export class JiraClient {
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

  private normalize(issue: any): JiraTicket {
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
      jiraUrl: `${config.jira.baseUrl()}/browse/${issue.key}`,
      parentKey: f.parent?.key ?? "",
      raw: issue,
    };
  }

  async fetchMyTickets(): Promise<JiraTicket[]> {
    if (!config.jira.configured()) return [];
    // /rest/api/2/search was removed (Atlassian CHANGE-2046); use /rest/api/3/search/jql
    const url = `${config.jira.baseUrl()}/rest/api/3/search/jql?jql=${encodeURIComponent(
      config.jira.jql()
    )}&maxResults=50&fields=summary,description,status,issuetype,priority,parent`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Jira search failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return (data.issues ?? []).map((i: any) => this.normalize(i));
  }

  async fetchTicket(key: string): Promise<JiraTicket> {
    const url = `${config.jira.baseUrl()}/rest/api/3/issue/${encodeURIComponent(
      key
    )}?fields=summary,description,status,issuetype,priority`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Jira issue fetch failed (${res.status}): ${await res.text()}`);
    return this.normalize(await res.json());
  }
}

export const jiraClient = new JiraClient();
