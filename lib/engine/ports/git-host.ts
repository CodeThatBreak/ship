import "server-only";

/**
 * Git-host integration port — the neutral language engine + API code speaks.
 *
 * Concrete hosts (GitLab, GitHub, …) implement `GitHostService` in
 * `lib/integrations/<host>/git-host.ts` and register themselves in
 * `gitHostRegistry`. Nothing outside the integration layer (and this
 * composition point) may import a concrete host client.
 *
 * Normalized vocabulary:
 *  - "change request" (CR) — a merge request / pull request
 *  - "pipeline"            — a CI run on a branch or CR
 *  - "comment" / "thread"  — review discussion notes; a thread groups comments,
 *                            only resolvable threads participate in the
 *                            resolve loop
 *
 * IDs and status vocabulary are host-shaped (the built-ins understand GitLab's
 * CI statuses today); adapters must keep them stable so persisted rows stay
 * meaningful across releases: `ChangeRequest.number` / pipeline & job ids are
 * the host's numeric identifiers (persisted in `mr_iid` / events / outputs),
 * comment ids are prefixed strings (`gl_<note id>`, the DB comment row id).
 */
import { GitLabHostService } from "../../integrations/gitlab/git-host";

/** Lowercased URL host ("gitlab.company.com"), null when unparseable. */
export const hostOf = (url: string): string | null => {
  const trimmed = url.trim();
  const sshMatch = trimmed.match(/^ssh:\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?/i);
  if (sshMatch) return sshMatch[1].toLowerCase();
  const scpMatch = trimmed.match(/^[^@]+@([^:/]+):/);
  if (scpMatch) return scpMatch[1].toLowerCase();
  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    return null;
  }
};

export type ChangeRequestDiffs = {
  changes: { oldPath: string; newPath: string; diff: string }[];
  /** true when the host truncated or capped the diff list */
  truncated: boolean;
};

/** The CI pipeline attached to a change request's head (null when none). */
export interface HeadPipelineInfo {
  id: number;
  status: string;
  webUrl: string;
}

/** A change request (merge request / pull request), normalized. */
export interface ChangeRequest {
  /** host-native stable id (string form) */
  id: string;
  /** host-native human number (GitLab MR iid, GitHub PR number) — DB `mr_iid` */
  number: number;
  title: string;
  state: string;
  webUrl: string;
  sourceBranch: string;
  targetBranch: string;
  sha: string;
  headPipeline?: HeadPipelineInfo | null;
  projectId: number;
}

/** A CI pipeline, normalized. */
export interface Pipeline {
  id: number;
  status: string;
  ref: string;
  sha: string;
  webUrl: string;
}

/** One review comment, normalized. `id` is the DB comment row id. */
export interface HostComment {
  id: string;
  /** the discussion/thread this comment belongs to (DB `discussion_id`) */
  threadId: string;
  body: string;
  author: string;
  /** participates in the resolve loop (only true for resolvable review threads) */
  resolvable: boolean;
  resolved: boolean;
  /** bot/system notes — ingested but never counted open */
  system: boolean;
  path?: string | null;
  line?: number | null;
  createdAt: string;
}

/** A CI pipeline job, normalized. */
export interface HostJob {
  id: number;
  name: string;
  status: string;
  /** the job waits for a human/agent to press play */
  manual: boolean;
}

/** A repository (project), normalized — only what the engine stores on flows. */
export interface HostProject {
  id: number;
  webUrl?: string | null;
}

/** A configured host instance (tenant/self-hosted deployment) — no secrets. */
export interface HostInstance {
  id: string;
  name: string | null;
  baseUrl: string;
  /** masked token ("••••abcd") for the settings UI — never the real value */
  tokenMasked: string;
}

/** Create-a-change-request input, normalized. */
export interface CreateChangeRequestInput {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description?: string;
}

/** A normalized webhook delivery from a git host. */
export type HostWebhookEvent =
  | {
      kind: "cr_comment";
      projectId: number;
      projectUrl: string;
      crNumber: number;
      comment: HostComment;
    }
  | {
      kind: "pipeline";
      projectId: number;
      projectUrl: string;
      /** null for non-CR pipeline events */
      crNumber: number | null;
      pipeline: { id: number; status: string };
    };

/**
 * Per-repo API surface for one host. Bound to a repo URL by the service —
 * every method fails loudly when the host has no instance for the repo.
 */
export interface GitHostClient {
  getChangeRequest(crNumber: number): Promise<ChangeRequest>;
  createChangeRequest(input: CreateChangeRequestInput): Promise<ChangeRequest>;
  listChangeRequestsByBranch(sourceBranch: string): Promise<ChangeRequest[]>;
  /** the diff of a change request, per file */
  getChanges(crNumber: number): Promise<ChangeRequestDiffs>;
  getPipeline(pipelineId: number): Promise<Pipeline>;
  /** pipeline for the CR's changed code (merged-results style) */
  createCRPipeline(crNumber: number): Promise<Pipeline>;
  /** plain branch pipeline — the "run pipeline" button, via API */
  createPipeline(ref: string): Promise<Pipeline>;
  listPipelineJobs(pipelineId: number): Promise<HostJob[]>;
  /** press play on a manual job so a manual-gated pipeline proceeds */
  playJob(jobId: number): Promise<unknown>;
  /** retry the failed/canceled jobs of a pipeline */
  retryPipeline(pipelineId: number): Promise<Pipeline>;
  getJobTrace(jobId: number): Promise<string>;
  listComments(crNumber: number): Promise<HostComment[]>;
  createComment(crNumber: number, body: string): Promise<unknown>;
  resolveComment(crNumber: number, threadId: string, resolved?: boolean): Promise<unknown>;
  getProject(): Promise<HostProject>;
}

/**
 * One git host integration. The registry's registered instances route every
 * repo-scoped call; instance CRUD + webhook verification + host metadata
 * (kind/label) back the settings UI and the webhook routes.
 */
export interface GitHostService {
  /** stable registry key, e.g. "gitlab" */
  readonly kind: string;
  /** UI label, e.g. "GitLab" */
  readonly label: string;

  /** True when usable at all (at least one registered instance). */
  configured(): boolean;
  /** True when this host has credentials for the given repo URL. */
  ownsRepo(repoUrl: string): boolean;
  /** API client bound to the instance that owns the given repo URL. */
  clientForRepo(repoUrl: string): GitHostClient;
  /** Token-authed HTTPS clone/push URL for a repo (host-specific scheme). */
  authedCloneUrl(repoUrl: string): string;

  // ── instance registry (settings admin) ───────────────────────────────────
  instances(): HostInstance[];
  addInstance(input: { name?: string | null; baseUrl: string; token: string }): HostInstance;
  /** Update by id; a blank/absent token keeps the stored one. */
  updateInstance(id: string, input: { name?: string | null; baseUrl?: string; token?: string }): void;
  removeInstance(id: string): void;
  /**
   * Quick reachability/auth check used by the settings page — tests the
   * stored instance's credentials, with optional overrides (e.g. the form
   * values before saving).
   */
  testInstance(id: string, input?: { baseUrl?: string; token?: string }): Promise<{ ok: boolean; detail: string }>;

  // ── webhook ingestion ────────────────────────────────────────────────────
  /** True when no secret is configured or the delivery's signature matches. */
  verifyWebhook(headers: { get(name: string): string | null }): boolean;
  /** Normalize a delivery body; null for event kinds the engine ignores. */
  parseWebhook(body: unknown): HostWebhookEvent | null;

  // ── repo-scoped convenience surface (what engine/API code calls) ─────────
  getChangeRequest(repoUrl: string, crNumber: number): Promise<ChangeRequest>;
  createChangeRequest(repoUrl: string, input: CreateChangeRequestInput): Promise<ChangeRequest>;
  listChangeRequestsByBranch(repoUrl: string, sourceBranch: string): Promise<ChangeRequest[]>;
  getChanges(repoUrl: string, crNumber: number): Promise<ChangeRequestDiffs>;
  getPipeline(repoUrl: string, pipelineId: number): Promise<Pipeline>;
  createCRPipeline(repoUrl: string, crNumber: number): Promise<Pipeline>;
  createPipeline(repoUrl: string, ref: string): Promise<Pipeline>;
  listPipelineJobs(repoUrl: string, pipelineId: number): Promise<HostJob[]>;
  playJob(repoUrl: string, jobId: number): Promise<unknown>;
  retryPipeline(repoUrl: string, pipelineId: number): Promise<Pipeline>;
  getJobTrace(repoUrl: string, jobId: number): Promise<string>;
  listComments(repoUrl: string, crNumber: number): Promise<HostComment[]>;
  createComment(repoUrl: string, crNumber: number, body: string): Promise<unknown>;
  resolveComment(repoUrl: string, crNumber: number, threadId: string, resolved?: boolean): Promise<unknown>;
  getProject(repoUrl: string): Promise<HostProject>;
}

/**
 * The git-host registry — the engine's single seam for anything host-shaped.
 * Mirrors `TaskProviderRegistry` (lib/engine/tasks/registry.ts): adding a host
 * = one adapter file + one `register()` line here.
 */
export class GitHostRegistry {
  private readonly registry = new Map<string, GitHostService>();

  constructor() {
    // Composition point: built-in adapters register here (the one place
    // concrete integrations are named on the engine side).
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    this.register(new GitLabHostService());
  }

  register(service: GitHostService): void {
    if (this.registry.has(service.kind)) {
      throw new Error(`duplicate git host kind: ${service.kind}`);
    }
    this.registry.set(service.kind, service);
  }

  /** Get a host by kind, or throw. */
  get(kind: string): GitHostService {
    const svc = this.registry.get(kind);
    if (!svc) throw new Error(`unknown git host kind: ${kind}`);
    return svc;
  }

  /** Get a host by kind, or undefined. */
  maybe(kind: string): GitHostService | undefined {
    return this.registry.get(kind);
  }

  /** All registered hosts (registration order). */
  list(): GitHostService[] {
    return [...this.registry.values()];
  }

  /** The host that serves the given repo URL, or throw. */
  forRepo(repoUrl: string): GitHostService {
    for (const svc of this.list()) {
      if (svc.ownsRepo(repoUrl)) return svc;
    }
    throw new Error(
      `no git host configured for repo "${repoUrl}" — add one on the Settings page`
    );
  }
}

/** The engine's git-host seam. */
export const gitHostRegistry = new GitHostRegistry();

/**
 * Token-authed clone/push URL for a repo, falling back to the raw URL when no
 * host is configured for it. Engine-side resolution handed to `lib/git` local
 * operations (ensureClone / pushBranch) — keeps `lib/git` free of engine
 * imports while the registry stays the only instance router.
 */
export function authedCloneUrlFor(repoUrl: string): string {
  try {
    return gitHostRegistry.forRepo(repoUrl).authedCloneUrl(repoUrl);
  } catch {
    return repoUrl;
  }
}
