import "server-only";

import { config } from "../../config";
import { NotFoundError } from "../../errors";
import type {
  ChangeRequest,
  CreateChangeRequestInput,
  GitHostClient,
  GitHostService,
  HostComment,
  HostInstance,
  HostJob,
  HostProject,
  HostWebhookEvent,
  Pipeline,
} from "../../engine/ports/git-host";
import { GitLabClient, gitLab, type Discussion, type MergeRequest, type Pipeline as GitLabPipeline } from "./client";

/** Masked token for the settings UI (never the real value). */
function maskToken(t: string): string {
  if (!t) return "";
  if (t.length <= 4) return "••••";
  return `••••${t.slice(-4)}`;
}

// ── shape normalization (GitLab snake_case → port camelCase) ────────────────

function mapChangeRequest(mr: MergeRequest): ChangeRequest {
  return {
    id: String(mr.id),
    number: mr.iid,
    title: mr.title,
    state: mr.state,
    webUrl: mr.web_url,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    sha: mr.sha,
    headPipeline: mr.head_pipeline
      ? { id: mr.head_pipeline.id, status: mr.head_pipeline.status, webUrl: mr.head_pipeline.web_url }
      : null,
    projectId: mr.project_id,
  };
}

function mapPipeline(p: GitLabPipeline): Pipeline {
  return { id: p.id, status: p.status, ref: p.ref, sha: p.sha, webUrl: p.web_url };
}

function mapDiscussion(d: Discussion): HostComment[] {
  return d.notes.map((n) => ({
    id: `gl_${n.id}`,
    threadId: d.id,
    body: n.body,
    author: n.author?.username ?? n.author?.name ?? "",
    resolvable: n.resolvable,
    resolved: n.resolved,
    system: n.system,
    path: n.position?.new_path ?? null,
    line: n.position?.new_line ?? null,
    createdAt: n.created_at,
  }));
}

function mapJobs(jobs: { id: number; name: string; status: string; when?: string }[]): HostJob[] {
  return jobs.map((j) => ({
    id: j.id,
    name: j.name,
    status: j.status,
    // playable = waiting for a human to press "play" (status manual, not when:never)
    manual: j.status === "manual" && j.when !== "never",
  }));
}

/**
 * Per-repo GitLab client view: a raw GitLabClient bound to the resolved
 * instance + the repo's URL-encoded project path.
 */
class GitLabHostClient implements GitHostClient {
  constructor(
    private readonly raw: GitLabClient,
    private readonly projectPath: string,
  ) {}

  getChangeRequest(crNumber: number): Promise<ChangeRequest> {
    return this.raw.getMR(this.projectPath, crNumber).then(mapChangeRequest);
  }

  createChangeRequest(input: CreateChangeRequestInput): Promise<ChangeRequest> {
    return this.raw
      .createMR(this.projectPath, {
        source_branch: input.sourceBranch,
        target_branch: input.targetBranch,
        title: input.title,
        description: input.description,
      })
      .then(mapChangeRequest);
  }

  listChangeRequestsByBranch(sourceBranch: string): Promise<ChangeRequest[]> {
    return this.raw.listMRsByBranch(this.projectPath, sourceBranch).then((mrs) => mrs.map(mapChangeRequest));
  }

  getChanges(crNumber: number): Promise<{ changes: { oldPath: string; newPath: string; diff: string }[] }> {
    return this.raw.getMRChanges(this.projectPath, crNumber).then((r: any) => ({
      changes: ((r.changes ?? []) as { old_path: string; new_path: string; diff: string }[]).map((c) => ({
        oldPath: c.old_path,
        newPath: c.new_path,
        diff: c.diff,
      })),
    }));
  }

  getPipeline(pipelineId: number): Promise<Pipeline> {
    return this.raw.getPipeline(this.projectPath, pipelineId).then(mapPipeline);
  }

  createCRPipeline(crNumber: number): Promise<Pipeline> {
    return this.raw.createMRPipeline(this.projectPath, crNumber).then(mapPipeline);
  }

  createPipeline(ref: string): Promise<Pipeline> {
    return this.raw.createPipeline(this.projectPath, ref).then(mapPipeline);
  }

  listPipelineJobs(pipelineId: number): Promise<HostJob[]> {
    return this.raw.listPipelineJobs(this.projectPath, pipelineId).then(mapJobs);
  }

  playJob(jobId: number): Promise<unknown> {
    return this.raw.playJob(this.projectPath, jobId);
  }

  retryPipeline(pipelineId: number): Promise<Pipeline> {
    return this.raw.retryPipeline(this.projectPath, pipelineId).then(mapPipeline);
  }

  getJobTrace(jobId: number): Promise<string> {
    return this.raw.getJobTrace(this.projectPath, jobId);
  }

  listComments(crNumber: number): Promise<HostComment[]> {
    return this.raw
      .listMRDiscussions(this.projectPath, crNumber)
      .then((discussions) => discussions.flatMap(mapDiscussion));
  }

  createComment(crNumber: number, body: string): Promise<unknown> {
    return this.raw.createMRNote(this.projectPath, crNumber, body);
  }

  resolveComment(crNumber: number, threadId: string, resolved = true): Promise<unknown> {
    return this.raw.resolveDiscussion(this.projectPath, crNumber, threadId, resolved);
  }

  getProject(): Promise<HostProject> {
    return this.raw.getProject(this.projectPath).then((p: any) => ({
      id: p.id,
      webUrl: p.web_url ?? null,
    }));
  }
}

/**
 * GitLab adapter for the git-host port: wraps the existing GitLabService /
 * GitLabClient (repo URL → instance routing, env fallback) and maps between
 * GitLab's shapes and the port's normalized vocabulary.
 */
export class GitLabHostService implements GitHostService {
  readonly kind = "gitlab";
  readonly label = "GitLab";

  configured(): boolean {
    return gitLab.configured();
  }

  ownsRepo(repoUrl: string): boolean {
    try {
      gitLab.instanceForRepo(repoUrl);
      return true;
    } catch {
      return false;
    }
  }

  clientForRepo(repoUrl: string): GitHostClient {
    return new GitLabHostClient(gitLab.clientFor(repoUrl), gitLab.projectPathFromUrl(repoUrl));
  }

  authedCloneUrl(repoUrl: string): string {
    // Credential scheme is the host's: GitLab accepts `oauth2:<token>` as the
    // HTTPS user. The resolved instance carries the token; without one, pass
    // the URL through untouched.
    let token = "";
    try {
      token = gitLab.instanceForRepo(repoUrl).token;
    } catch {
      token = "";
    }
    if (!token) return repoUrl;
    // https://oauth2:TOKEN@host/group/repo.git — the .git suffix matters: without
    // it some GitLab fronts 301-redirect and git push fails on the redirect.
    const withAuth = repoUrl.replace(/^https?:\/\//, (m) => `${m}oauth2:${token}@`);
    return withAuth.endsWith(".git") ? withAuth : `${withAuth}.git`;
  }

  // ── instance registry (settings admin) ───────────────────────────────────

  instances(): HostInstance[] {
    return gitLab.listInstances().map(({ id, name, base_url, token }) => ({
      id,
      name,
      baseUrl: base_url,
      tokenMasked: maskToken(token),
    }));
  }

  addInstance(input: { name?: string | null; baseUrl: string; token: string }): HostInstance {
    const inst = gitLab.addInstance({ name: input.name ?? undefined, base_url: input.baseUrl, token: input.token });
    return { id: inst.id, name: inst.name, baseUrl: inst.base_url, tokenMasked: maskToken(inst.token) };
  }

  updateInstance(id: string, input: { name?: string | null; baseUrl?: string; token?: string }): void {
    const existing = gitLab.listInstances().find((i) => i.id === id);
    if (!existing) throw new NotFoundError("host instance", id);
    gitLab.updateInstance(id, {
      name: input.name ?? existing.name ?? undefined,
      base_url: input.baseUrl ?? existing.base_url,
      // blank token = keep the stored one
      token: input.token || existing.token,
    });
  }

  removeInstance(id: string): void {
    gitLab.deleteInstance(id);
  }

  async testInstance(id: string, input: { baseUrl?: string; token?: string } = {}): Promise<{ ok: boolean; detail: string }> {
    const existing = gitLab.listInstances().find((i) => i.id === id);
    if (!existing) throw new NotFoundError("host instance", id);
    return gitLab.testInstance(input.baseUrl ?? existing.base_url, input.token || existing.token);
  }

  // ── webhook ingestion ────────────────────────────────────────────────────

  verifyWebhook(headers: { get(name: string): string | null }): boolean {
    const secret = config.gitlab.webhookSecret();
    if (!secret) return true;
    return headers.get("x-gitlab-token") === secret;
  }

  parseWebhook(body: unknown): HostWebhookEvent | null {
    const p = body as any;
    const projectId = p?.project?.id as number | undefined;
    const projectUrl = (p?.project?.web_url ?? p?.project?.homepage ?? "") as string;
    const kind = p?.object_kind;
    if (kind === "note" && projectId) {
      const mr = p?.merge_request;
      const n = p?.object_attributes;
      if (!mr?.iid || !n) return null;
      return {
        kind: "cr_comment",
        projectId,
        projectUrl,
        crNumber: mr.iid,
        comment: {
          id: `gl_${n.id}`,
          threadId: n.discussion_id ?? `ind_${n.id}`,
          body: n.note,
          author: p?.user?.username ?? p?.user?.name ?? "",
          resolvable: n.type === "DiffNote",
          resolved: false,
          system: false,
          path: n.position?.new_path ?? null,
          line: n.position?.new_line ?? null,
          createdAt: n.created_at,
        },
      };
    }
    if (kind === "pipeline" && projectId) {
      const attrs = p?.object_attributes;
      if (!attrs?.id || !attrs?.status) return null;
      return {
        kind: "pipeline",
        projectId,
        projectUrl,
        crNumber: p?.merge_request?.iid ?? null,
        pipeline: { id: attrs.id, status: attrs.status },
      };
    }
    return null;
  }

  // ── repo-scoped convenience surface ──────────────────────────────────────

  getChangeRequest(repoUrl: string, crNumber: number): Promise<ChangeRequest> {
    return this.clientForRepo(repoUrl).getChangeRequest(crNumber);
  }

  createChangeRequest(repoUrl: string, input: CreateChangeRequestInput): Promise<ChangeRequest> {
    return this.clientForRepo(repoUrl).createChangeRequest(input);
  }

  listChangeRequestsByBranch(repoUrl: string, sourceBranch: string): Promise<ChangeRequest[]> {
    return this.clientForRepo(repoUrl).listChangeRequestsByBranch(sourceBranch);
  }

  getChanges(repoUrl: string, crNumber: number): ReturnType<GitHostClient["getChanges"]> {
    return this.clientForRepo(repoUrl).getChanges(crNumber);
  }

  getPipeline(repoUrl: string, pipelineId: number): Promise<Pipeline> {
    return this.clientForRepo(repoUrl).getPipeline(pipelineId);
  }

  createCRPipeline(repoUrl: string, crNumber: number): Promise<Pipeline> {
    return this.clientForRepo(repoUrl).createCRPipeline(crNumber);
  }

  createPipeline(repoUrl: string, ref: string): Promise<Pipeline> {
    return this.clientForRepo(repoUrl).createPipeline(ref);
  }

  listPipelineJobs(repoUrl: string, pipelineId: number): Promise<HostJob[]> {
    return this.clientForRepo(repoUrl).listPipelineJobs(pipelineId);
  }

  playJob(repoUrl: string, jobId: number): Promise<unknown> {
    return this.clientForRepo(repoUrl).playJob(jobId);
  }

  retryPipeline(repoUrl: string, pipelineId: number): Promise<Pipeline> {
    return this.clientForRepo(repoUrl).retryPipeline(pipelineId);
  }

  getJobTrace(repoUrl: string, jobId: number): Promise<string> {
    return this.clientForRepo(repoUrl).getJobTrace(jobId);
  }

  listComments(repoUrl: string, crNumber: number): Promise<HostComment[]> {
    return this.clientForRepo(repoUrl).listComments(crNumber);
  }

  createComment(repoUrl: string, crNumber: number, body: string): Promise<unknown> {
    return this.clientForRepo(repoUrl).createComment(crNumber, body);
  }

  resolveComment(repoUrl: string, crNumber: number, threadId: string, resolved?: boolean): Promise<unknown> {
    return this.clientForRepo(repoUrl).resolveComment(crNumber, threadId, resolved ?? true);
  }

  getProject(repoUrl: string): Promise<HostProject> {
    return this.clientForRepo(repoUrl).getProject();
  }
}
