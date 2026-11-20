import "server-only";

import { db } from "../../../db/app";
import type { JiraInstance, Task } from "../../../db/rows";
import { jsonInput } from "@/lib/db/ormRowHelpers";
import { UpstreamError, ValidationError } from "../../../errors";
import { baseUrlOverrideRequiresToken } from "../../../integrations/instanceCredentialPolicy";
import { truncateUpstreamBody } from '../../ports/utils/upstreamErrorText';
import { AdfRenderer } from "../../../integrations/jira/adfRenderer";
import { jiraAuthHeaders, jiraMyselfPath, jiraSearchPath, type JiraAuthMode } from "../../../integrations/jira/apiProfile";
import { JIRA_HTTP_TIMEOUT_MS } from "../../../integrations/jira/constants";
import { jira } from "../../../integrations/jira/singleton";
import { maskToken } from "../../../integrations/jira/service";
import {
  TaskProvider,
} from "../taskProvider";
import type {
  LiveTask,
  LiveTaskFilters,
  ProviderInstance,
  TaskField,
  TaskInstanceStore,
} from "../types/taskProvider";
import type { JiraIssue } from "./jira/types/jiraIssue";

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

  /** Figma links scanned out of issue summary + description. */
  private static readonly FIGMA_RE = /https?:\/\/(?:www\.)?figma\.com\/[^\s)\]"']+/g;

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

  override async configured(): Promise<boolean> {
    return jira.configured();
  }

  /** The issue's external deep link (stored link wins; instance baseUrl as fallback). */
  override async externalUrl(task: Task): Promise<string> {
    const inst = await jira.active();
    return task.externalUrl || `${inst?.baseUrl ?? ""}/browse/${task.key}`;
  }

  /** ── instance registry (Settings → Integrations → Task) ────────────────── */

  override instanceStore(): TaskInstanceStore {
    return this;
  }

  async instances(): Promise<ProviderInstance[]> {
    const list = await jira.listInstances();
    return list.map(({ id, name, baseUrl, email }) => ({
      id, name, baseUrl, email, tokenMasked: "••••",
    }));
  }

  async addInstance(input: { name?: string | null; baseUrl: string; email?: string; token: string }): Promise<ProviderInstance> {
    const inst = await jira.addInstance({
      name: input.name ?? undefined,
      baseUrl: input.baseUrl,
      email: input.email ?? "",
      token: input.token,
    });
    return { id: inst.id, name: inst.name, baseUrl: inst.baseUrl, email: inst.email, tokenMasked: maskToken(inst.token) };
  }

  async updateInstance(id: string, input: { name?: string | null; baseUrl?: string; email?: string; token?: string }): Promise<void> {
    const existing = await jira.getInstance(id);
    if (!existing) throw new Error(`jira instance not found: ${id}`);
    if (baseUrlOverrideRequiresToken(existing.baseUrl, input.baseUrl, input.token)) {
      throw new ValidationError("token is required when overriding baseUrl");
    }
    await jira.updateInstance(id, {
      name: input.name,
      baseUrl: input.baseUrl,
      email: input.email,
      token: input.token,
    });
  }

  async removeInstance(id: string): Promise<void> {
    await jira.deleteInstance(id);
  }

  async testInstance(
    id: string,
    input: { baseUrl?: string; email?: string; token?: string } = {}
  ): Promise<{ ok: boolean; detail: string }> {
    const existing = await jira.getInstance(id);
    if (!existing) throw new Error(`jira instance not found: ${id}`);
    if (baseUrlOverrideRequiresToken(existing.baseUrl, input.baseUrl, input.token)) {
      throw new ValidationError("token is required when overriding baseUrl");
    }
    return jira.testInstance(
      input.baseUrl ?? existing.baseUrl,
      input.email ?? existing.email,
      input.token?.trim() || existing.token
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
  override async upsertLive(task: LiveTask): Promise<string> {
    const issue: JiraIssue = {
      id: task.id,
      key: task.key,
      summary: task.summary,
      description: task.description,
      status: task.status,
      issueType: task.issueType,
      priority: task.priority,
      prdText: typeof task.fields.prd === "string" ? task.fields.prd : "",
      figmaUrls: Array.isArray(task.fields.figmaUrls)
        ? (task.fields.figmaUrls as string[])
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
      fields: { prd: issue.prdText, figmaUrls: issue.figmaUrls },
      raw: issue.raw,
    };
  }

  // ── transport + normalization (single source of truth for jira logic) ────

  private async headers(): Promise<HeadersInit> {
    const inst = await jira.active();
    if (!inst) return { Accept: "application/json" };
    return jiraAuthHeaders(inst, await jira.authMode(inst));
  }

  /** Heuristically split a PRD out of the description. */
  private extractPrd(desc: string): string {
    const m = desc.match(/(?:^|\n)#+\s*(PRD|Product Requirements|Requirements)[\s\S]*/i);
    return m ? m[0].trim() : desc;
  }

  private async normalize(issue: { id: string | number; key: string; fields?: Record<string, unknown> }): Promise<JiraIssue> {
    const f = issue.fields ?? {};
    const descText =
      typeof f.description === "string" ? f.description : AdfRenderer.toText(f.description);
    const summary = typeof f.summary === "string" ? f.summary : "";
    const full = `${summary}\n${descText}`;
    const figma = Array.from(new Set(full.match(JiraTaskProvider.FIGMA_RE) ?? []));
    const statusObj = f.status as { name?: string } | undefined;
    const typeObj = f.issuetype as { name?: string } | undefined;
    const priorityObj = f.priority as { name?: string } | undefined;
    const parentObj = f.parent as { key?: string } | undefined;
    const inst = await jira.active();
    return {
      id: String(issue.id),
      key: issue.key,
      summary,
      description: descText,
      status: statusObj?.name ?? "",
      issueType: typeObj?.name ?? "",
      priority: priorityObj?.name ?? "",
      prdText: this.extractPrd(descText || summary || ""),
      figmaUrls: figma,
      externalUrl: `${inst?.baseUrl ?? ""}/browse/${issue.key}`,
      parentKey: parentObj?.key ?? "",
      raw: issue,
    };
  }

  private async fetchByJql(jql: string): Promise<JiraIssue[]> {
    const inst = await jira.active();
    if (!inst) return [];
    const mode = await jira.authMode(inst);
    const url = `${inst.baseUrl}${jiraSearchPath(mode)}?jql=${encodeURIComponent(
      jql,
    )}&maxResults=50&fields=summary,description,status,issuetype,priority,parent`;
    const res = await fetch(url, {
      headers: await this.headers(),
      signal: AbortSignal.timeout(JIRA_HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new UpstreamError(
        `Jira search failed (${res.status}): ${truncateUpstreamBody(await res.text())}`,
        res.status,
      );
    }
    const data = (await res.json()) as { issues?: unknown[] };
    const rawIssues = data.issues ?? [];
    if (rawIssues.length === 0) {
      await this.assertAuthenticated(inst, mode);
    }
    const issues: JiraIssue[] = [];
    for (const i of rawIssues) {
      issues.push(await this.normalize(i as { id: string | number; key: string; fields?: Record<string, unknown> }));
    }
    return issues;
  }

  /** Jira search can return 200 with an empty list when auth is invalid — verify /myself. */
  private async assertAuthenticated(
    inst: JiraInstance,
    mode: JiraAuthMode,
  ): Promise<void> {
    const myselfRes = await fetch(`${inst.baseUrl}${jiraMyselfPath(mode)}`, {
      headers: await this.headers(),
      signal: AbortSignal.timeout(JIRA_HTTP_TIMEOUT_MS),
    });
    if (myselfRes.ok) return;
    throw new UpstreamError(
      `Jira authentication failed (${myselfRes.status}): ${truncateUpstreamBody(await myselfRes.text())}`,
      myselfRes.status,
    );
  }

  /** Upsert one issue as a task row (idempotent on key) and return its row id. */
  private async upsert(issue: JiraIssue, ts: string): Promise<string> {
    // JSONB column: bind the payload object directly (no JSON.stringify)
    const fields = { prd: issue.prdText, figmaUrls: issue.figmaUrls };
    const existing = await db.prisma.task.findFirst({ where: { key: issue.key }, select: { id: true } });
    if (existing) {
      await db.prisma.task.updateMany({
        where: { key: issue.key },
        data: {
          summary: issue.summary,
          description: issue.description,
          status: issue.status,
          issueType: issue.issueType,
          priority: issue.priority,
          externalUrl: issue.externalUrl,
          parentKey: issue.parentKey || null,
          raw: JSON.stringify(issue.raw),
          fields: jsonInput(fields),
          syncedAt: ts,
        },
      });
      return existing.id;
    }
    await db.prisma.task.createMany({
      data: [{
        id: db.uid("task_"),
        key: issue.key,
        summary: issue.summary,
        description: issue.description,
        status: issue.status,
        issueType: issue.issueType,
        priority: issue.priority,
        repoUrl: null,
        parentKey: issue.parentKey || null,
        externalUrl: issue.externalUrl,
        raw: JSON.stringify(issue.raw),
        fields: jsonInput(fields),
        type: "jira",
        syncedAt: ts,
      }],
      skipDuplicates: true,
    });
    const row = await db.prisma.task.findFirst({ where: { key: issue.key }, select: { id: true } });
    if (!row) throw new Error(`failed to insert task row for ${issue.key}`);
    return row.id;
  }
}
