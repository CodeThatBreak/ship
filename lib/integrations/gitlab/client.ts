import { config } from "../../config";
import { db } from "../../db";

export interface GitLabInstance {
  id: string;
  name: string | null;
  base_url: string;
  token: string;
}

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

/** Host of a URL, lowercased (null when unparseable). */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

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

  private async api<T = any>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers || {}) },
    });
    if (!res.ok) throw new Error(`GitLab ${path} failed (${res.status}): ${await res.text()}`);
    return res.json() as Promise<T>;
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
    return this.api(
      `/projects/${projectPath}/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&state=opened`
    );
  }

  async getMRChanges(projectPath: string, mrIid: number) {
    return this.api(`/projects/${projectPath}/merge_requests/${mrIid}/changes`);
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
    return this.api(`/projects/${projectPath}/pipelines/${pipelineId}/jobs`);
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
    const res = await fetch(`${this.baseUrl}/projects/${projectPath}/jobs/${jobId}/trace`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`trace failed (${res.status})`);
    return res.text();
  }

  async listMRDiscussions(projectPath: string, mrIid: number): Promise<Discussion[]> {
    return this.api(`/projects/${projectPath}/merge_requests/${mrIid}/discussions?per_page=100`);
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
 * GitLab integration: registry of configured instances (DB-backed, with the
 * env-based instance as back-compat fallback) and the repo-URL → instance
 * routing every API call goes through.
 */
export class GitLabService {
  private static host(url: string): string | null {
    return hostOf(url);
  }

  // ── instance registry ────────────────────────────────────────────────────
  listInstances(): GitLabInstance[] {
    return db.all<GitLabInstance>(`SELECT * FROM gitlab_instances ORDER BY base_url`);
  }

  addInstance(input: { name?: string; base_url: string; token: string }): GitLabInstance {
    const baseUrl = input.base_url.trim().replace(/\/+$/, "");
    const id = db.uid("gli_");
    db.run(`INSERT INTO gitlab_instances (id,name,base_url,token,created_at) VALUES (?,?,?,?,?)`,
      id, input.name ?? null, baseUrl, input.token, db.now());
    return { id, name: input.name ?? null, base_url: baseUrl, token: input.token };
  }

  updateInstance(id: string, input: { name?: string; base_url: string; token: string }): void {
    db.run(`UPDATE gitlab_instances SET name=?, base_url=?, token=? WHERE id=?`,
      input.name ?? null, input.base_url.trim().replace(/\/+$/, ""), input.token, id);
  }

  deleteInstance(id: string): void {
    db.run(`DELETE FROM gitlab_instances WHERE id=?`, id);
  }

  /**
   * Resolve the GitLab credentials for a repo cloud URL.
   * Priority: registered instance whose host matches → env config (back-compat).
   */
  instanceForRepo(repoUrl: string): GitLabInstance {
    const h = GitLabService.host(repoUrl);
    const instances = this.listInstances();
    // longest base_url match first (handles gitlab.company.com/group subpath setups)
    const match = instances
      .filter((i) => GitLabService.host(i.base_url) === h)
      .sort((a, b) => b.base_url.length - a.base_url.length)[0];
    if (match) return match;
    const envBase = config.gitlab.baseUrl();
    const envToken = config.gitlab.token();
    if (envBase && envToken) {
      return { id: "env", name: "env", base_url: envBase, token: envToken };
    }
    if (instances.length === 1) return instances[0];
    throw new Error(
      `No GitLab instance configured for host "${h ?? repoUrl}". Add one on the Settings page.`
    );
  }

  /** True when GitLab is usable at all (env or at least one instance). */
  configured(): boolean {
    return config.gitlab.configured() || this.listInstances().length > 0;
  }

  /** API client bound to the instance that owns the given repo URL. */
  clientFor(repoUrl: string): GitLabClient {
    return new GitLabClient(this.instanceForRepo(repoUrl));
  }

  /** Turn a repo URL into a URL-encoded GitLab project path. */
  projectPathFromUrl(repoUrl: string): string {
    const u = db.normalizeRepoUrl(repoUrl);
    const m = u.match(/^[a-z]+:\/\/[^/]+\/(.+)$/i);
    return encodeURIComponent(m ? m[1] : u);
  }

  /** Project path (group/repo) without host, not URL-encoded. */
  projectNameFromUrl(repoUrl: string): string {
    const u = db.normalizeRepoUrl(repoUrl);
    const m = u.match(/^[a-z]+:\/\/[^/]+\/(.+)$/i);
    return m ? m[1] : u;
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

  getMRChanges(repoUrl: string, mrIid: number) {
    return this.clientFor(repoUrl).getMRChanges(this.projectPathFromUrl(repoUrl), mrIid);
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
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}` };
      const user = (await res.json()) as any;
      return { ok: true, detail: `Authenticated as ${user.username ?? user.name ?? "user"}` };
    } catch (e: any) {
      return { ok: false, detail: e?.message ?? String(e) };
    }
  }
}

export const gitLab = new GitLabService();
