import "server-only";

import type { Database } from "../../db/database";
import type { GitLabInstanceStore, GitLabInstanceMeta } from "../../db/stores/gitlabInstanceStore";
import { type GitLabInstance } from "../../db/rows";
import {
  GitHostTimeoutError,
  gitHostErrorFromResponse,
  parseRetryAfterMs,
  redactSecretsInText,
  truncateUpstreamBody,
} from "../../engine/ports/gitHostErrors";
import {
  GITLAB_HTTP_TIMEOUT_MS,
  GITLAB_MAX_GET_RETRIES,
  GITLAB_MAX_LIST_PAGES,
  GITLAB_RETRYABLE_STATUSES,
} from "./constants";
import { encodedProjectPathFromRepoUrl, hostOfRepoUrl, projectPathFromRepoUrl } from "./repoUrl";

export type { GitLabInstance } from "../../db/rows";

export interface MergeRequest {
  iid: number;
  id: number;
  title: string;
  state: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  sha: string;
  head_pipeline?: { id: number; status: string; web_url: string } | null;
  project_id: number;
}

export interface Pipeline {
  id: number;
  status: string;
  ref: string;
  sha: string;
  web_url: string;
}

export interface Note {
  id: number;
  body: string;
  author: { username: string; name: string };
  resolvable: boolean;
  resolved: boolean;
  system: boolean;
  position?: { new_path?: string; new_line?: number } | null;
  created_at: string;
}

export interface Discussion {
  id: string;
  individual_note: boolean;
  notes: Note[];
}

export interface MergeRequestDiff {
  old_path: string;
  new_path: string;
  diff: string;
}

/** @deprecated use hostOfRepoUrl from ./repo-url */
export const hostOf = hostOfRepoUrl;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * HTTP client for one GitLab instance (v4 API, PRIVATE-TOKEN auth).
 * Constructed with the instance credentials; shared by all repo calls
 * routed to that instance.
 */
export class GitLabClient {
  constructor(private readonly instance: GitLabInstance) {}

  private get baseUrl(): string {
    return `${this.instance.base_url.replace(/\/+$/, "")}/api/v4`;
  }

  private headers(): HeadersInit {
    return { "PRIVATE-TOKEN": this.instance.token, "Content-Type": "application/json" };
  }

  private redactBody(body: string): string {
    return redactSecretsInText(truncateUpstreamBody(body), [this.instance.token]);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const idempotentGet = method === "GET";
    let attempt = 0;

    for (;;) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          headers: { ...this.headers(), ...(init.headers || {}) },
          signal: AbortSignal.timeout(GITLAB_HTTP_TIMEOUT_MS),
        });

        if (res.ok) return res;

        const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
        const bodyText = await res.text();
        if (
          idempotentGet &&
          GITLAB_RETRYABLE_STATUSES.has(res.status) &&
          attempt < GITLAB_MAX_GET_RETRIES
        ) {
          attempt += 1;
          await sleep(retryAfterMs ?? Math.min(1000 * 2 ** attempt, 8000));
          continue;
        }
        throw gitHostErrorFromResponse(path, res.status, this.redactBody(bodyText), retryAfterMs);
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "TimeoutError") {
          throw new GitHostTimeoutError(path, GITLAB_HTTP_TIMEOUT_MS);
        }
        throw e;
      }
    }
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init);
    return res.json() as Promise<T>;
  }

  private async paginate<T>(path: string, init?: RequestInit): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    let page = 1;
    let truncated = false;

    for (;;) {
      const sep = path.includes("?") ? "&" : "?";
      const res = await this.request(`${path}${sep}per_page=100&page=${page}`, init);
      const chunk = (await res.json()) as T[];
      items.push(...chunk);
      const nextPage = res.headers.get("x-next-page");
      if (!nextPage) break;
      if (page >= GITLAB_MAX_LIST_PAGES) {
        truncated = true;
        break;
      }
      page = Number(nextPage);
      if (!Number.isFinite(page) || page < 1) break;
    }

    return { items, truncated };
  }

  async getMR(projectPath: string, mrIid: number): Promise<MergeRequest> {
    return this.api(`/projects/${projectPath}/merge_requests/${mrIid}`);
  }

  async createMR(
    projectPath: string,
    input: { source_branch: string; target_branch: string; title: string; description?: string }
  ): Promise<MergeRequest> {
    return this.api(`/projects/${projectPath}/merge_requests`, {
      method: "POST",
      body: JSON.stringify({ ...input, remove_source_branch: false }),
    });
  }

  async listMRsByBranch(projectPath: string, sourceBranch: string): Promise<MergeRequest[]> {
    const q = `source_branch=${encodeURIComponent(sourceBranch)}&state=opened`;
    const { items } = await this.paginate<MergeRequest>(
      `/projects/${projectPath}/merge_requests?${q}`,
    );
    return items;
  }

  async getMRDiffs(
    projectPath: string,
    mrIid: number,
  ): Promise<{ diffs: MergeRequestDiff[]; truncated: boolean }> {
    const { items, truncated } = await this.paginate<MergeRequestDiff>(
      `/projects/${projectPath}/merge_requests/${mrIid}/diffs`,
    );
    return { diffs: items, truncated };
  }

  async getPipeline(projectPath: string, pipelineId: number): Promise<Pipeline> {
    return this.api(`/projects/${projectPath}/pipelines/${pipelineId}`);
  }

  /** Create a merge-request pipeline (merged results; needs MR pipelines enabled). */
  async createMRPipeline(projectPath: string, mrIid: number): Promise<Pipeline> {
    return this.api(`/projects/${projectPath}/merge_requests/${mrIid}/pipelines`, { method: "POST" });
  }

  /** Create a plain branch pipeline — the "Run pipeline" button, via API. */
  async createPipeline(projectPath: string, ref: string): Promise<Pipeline> {
    return this.api(`/projects/${projectPath}/pipelines`, {
      method: "POST",
      body: JSON.stringify({ ref }),
    });
  }

  async listPipelineJobs(projectPath: string, pipelineId: number) {
    const { items } = await this.paginate<{ id: number; name: string; status: string; when?: string }>(
      `/projects/${projectPath}/pipelines/${pipelineId}/jobs`,
    );
    return items;
  }

  /** Play a manual job (the "play" button) so a manual-gated pipeline proceeds. */
  async playJob(projectPath: string, jobId: number) {
    return this.api(`/projects/${projectPath}/jobs/${jobId}/play`, { method: "POST" });
  }

  /** Retry the failed/canceled jobs of a pipeline (the "retry" button). */
  async retryPipeline(projectPath: string, pipelineId: number): Promise<Pipeline> {
    return this.api(`/projects/${projectPath}/pipelines/${pipelineId}/retry`, { method: "POST" });
  }

  async getJobTrace(projectPath: string, jobId: number): Promise<string> {
    const res = await this.request(`/projects/${projectPath}/jobs/${jobId}/trace`, {
      headers: { "PRIVATE-TOKEN": this.instance.token },
    });
    return res.text();
  }

  async listMRDiscussions(projectPath: string, mrIid: number): Promise<Discussion[]> {
    const { items } = await this.paginate<Discussion>(
      `/projects/${projectPath}/merge_requests/${mrIid}/discussions`,
    );
    return items;
  }

  async createMRNote(projectPath: string, mrIid: number, body: string) {
    return this.api(`/projects/${projectPath}/merge_requests/${mrIid}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async resolveDiscussion(projectPath: string, mrIid: number, discussionId: string, resolved = true) {
    return this.api(
      `/projects/${projectPath}/merge_requests/${mrIid}/discussions/${discussionId}?resolved=${resolved}`,
      { method: "PUT" }
    );
  }

  async getProject(projectPath: string) {
    return this.api(`/projects/${projectPath}`);
  }
}

/**
 * GitLab integration: registry of configured instances (Settings →
 * Integrations → Git, DB-backed) and the repo-URL → instance routing every
 * API call goes through. There is no env fallback — credentials live only
 * in the settings store.
 */
export class GitLabService {
  constructor(
    private readonly instances: GitLabInstanceStore,
    private readonly database: Pick<Database, "uid" | "now" | "normalizeRepoUrl">,
  ) {}

  private static host(url: string): string | null {
    return hostOfRepoUrl(url);
  }

  // ── instance registry ────────────────────────────────────────────────────
  listInstances(): GitLabInstanceMeta[] {
    return this.instances.listMeta();
  }

  getInstance(id: string): GitLabInstance | undefined {
    return this.instances.get(id);
  }

  addInstance(input: { name?: string; base_url: string; token: string }): GitLabInstance {
    return this.instances.add(input);
  }

  updateInstance(id: string, input: { name?: string; base_url: string; token: string }): void {
    this.instances.update(id, input);
  }

  deleteInstance(id: string): void {
    this.instances.delete(id);
  }

  /**
   * Resolve the GitLab credentials for a repo cloud URL: the registered
   * instance whose host matches wins (longest base_url first — handles
   * gitlab.company.com/group subpath setups); with exactly one instance
   * registered it serves SSH-style URLs with no parseable host only.
   */
  instanceForRepo(repoUrl: string): GitLabInstance {
    const h = GitLabService.host(repoUrl);
    const instances = this.listInstances();
    const match = instances
      .filter((i) => GitLabService.host(i.base_url) === h)
      .sort((a, b) => b.base_url.length - a.base_url.length)[0];
    if (match) {
      return { ...match, token: this.instances.readToken(match.id) };
    }
    if (instances.length === 1 && h === null) {
      const only = instances[0];
      return { ...only, token: this.instances.readToken(only.id) };
    }
    throw new Error(
      `No GitLab instance configured for host "${h ?? repoUrl}". Add one on the Settings page.`
    );
  }

  /** True when GitLab is usable at all (at least one registered instance). */
  configured(): boolean {
    return this.listInstances().length > 0;
  }

  /** API client bound to the instance that owns the given repo URL. */
  clientFor(repoUrl: string): GitLabClient {
    return new GitLabClient(this.instanceForRepo(repoUrl));
  }

  /** Turn a repo URL into a URL-encoded GitLab project path. */
  projectPathFromUrl(repoUrl: string): string {
    return encodedProjectPathFromRepoUrl(this.database.normalizeRepoUrl(repoUrl));
  }

  /** Project path (group/repo) without host, not URL-encoded. */
  projectNameFromUrl(repoUrl: string): string {
    return projectPathFromRepoUrl(this.database.normalizeRepoUrl(repoUrl));
  }

  // ── repo-scoped API operations (instance resolved per call) ─────────────
  getMR(repoUrl: string, mrIid: number): Promise<MergeRequest> {
    return this.clientFor(repoUrl).getMR(this.projectPathFromUrl(repoUrl), mrIid);
  }

  createMR(
    repoUrl: string,
    input: { source_branch: string; target_branch: string; title: string; description?: string }
  ): Promise<MergeRequest> {
    return this.clientFor(repoUrl).createMR(this.projectPathFromUrl(repoUrl), input);
  }

  listMRsByBranch(repoUrl: string, sourceBranch: string): Promise<MergeRequest[]> {
    return this.clientFor(repoUrl).listMRsByBranch(this.projectPathFromUrl(repoUrl), sourceBranch);
  }

  getMRDiffs(repoUrl: string, mrIid: number) {
    return this.clientFor(repoUrl).getMRDiffs(this.projectPathFromUrl(repoUrl), mrIid);
  }

  getPipeline(repoUrl: string, pipelineId: number): Promise<Pipeline> {
    return this.clientFor(repoUrl).getPipeline(this.projectPathFromUrl(repoUrl), pipelineId);
  }

  createMRPipeline(repoUrl: string, mrIid: number): Promise<Pipeline> {
    return this.clientFor(repoUrl).createMRPipeline(this.projectPathFromUrl(repoUrl), mrIid);
  }

  createPipeline(repoUrl: string, ref: string): Promise<Pipeline> {
    return this.clientFor(repoUrl).createPipeline(this.projectPathFromUrl(repoUrl), ref);
  }

  listPipelineJobs(repoUrl: string, pipelineId: number) {
    return this.clientFor(repoUrl).listPipelineJobs(this.projectPathFromUrl(repoUrl), pipelineId);
  }

  playJob(repoUrl: string, jobId: number) {
    return this.clientFor(repoUrl).playJob(this.projectPathFromUrl(repoUrl), jobId);
  }

  retryPipeline(repoUrl: string, pipelineId: number): Promise<Pipeline> {
    return this.clientFor(repoUrl).retryPipeline(this.projectPathFromUrl(repoUrl), pipelineId);
  }

  getJobTrace(repoUrl: string, jobId: number): Promise<string> {
    return this.clientFor(repoUrl).getJobTrace(this.projectPathFromUrl(repoUrl), jobId);
  }

  listMRDiscussions(repoUrl: string, mrIid: number): Promise<Discussion[]> {
    return this.clientFor(repoUrl).listMRDiscussions(this.projectPathFromUrl(repoUrl), mrIid);
  }

  createMRNote(repoUrl: string, mrIid: number, body: string) {
    return this.clientFor(repoUrl).createMRNote(this.projectPathFromUrl(repoUrl), mrIid, body);
  }

  resolveDiscussion(repoUrl: string, mrIid: number, discussionId: string, resolved = true) {
    return this.clientFor(repoUrl).resolveDiscussion(this.projectPathFromUrl(repoUrl), mrIid, discussionId, resolved);
  }

  getProject(repoUrl: string) {
    return this.clientFor(repoUrl).getProject(this.projectPathFromUrl(repoUrl));
  }

  /** Quick reachability/auth check used by the Settings page. */
  async testInstance(baseUrl: string, token: string): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/v4/user`, {
        headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(GITLAB_HTTP_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = truncateUpstreamBody(await res.text());
        return { ok: false, detail: `HTTP ${res.status}: ${redactSecretsInText(detail, [token])}` };
      }
      const user = (await res.json()) as { username?: string; name?: string };
      return { ok: true, detail: `Authenticated as ${user.username ?? user.name ?? "user"}` };
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "TimeoutError") {
        return { ok: false, detail: `Timed out after ${GITLAB_HTTP_TIMEOUT_MS}ms` };
      }
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}
