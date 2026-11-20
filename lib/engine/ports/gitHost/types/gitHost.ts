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

/** SHAs GitLab uses to anchor an inline MR discussion on the diff. */
export interface ChangeRequestDiffRefs {
  baseSha: string;
  startSha: string;
  headSha: string;
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
  /** Present when the host exposes MR diff refs (required for inline review threads). */
  diffRefs?: ChangeRequestDiffRefs | null;
}

/** Host context for posting a review comment on a specific diff line. */
export type InlineCommentPositionContext = {
  diffRefs: ChangeRequestDiffRefs | null | undefined;
  changes: ChangeRequestDiffs["changes"];
};

export type InlineCommentInput = {
  path: string;
  line: number;
  body: string;
};

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

/** A note the host created on our behalf (a reply posted into a thread). */
export interface HostNote {
  /** host-native note id, normalized to the comment id scheme (`gl_<noteId>`) */
  id: string;
  author: string;
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
  /** Inline diff thread when path/line resolve against `positionContext`; throws when not postable. */
  createInlineComment(
    crNumber: number,
    input: InlineCommentInput,
    positionContext: InlineCommentPositionContext,
  ): Promise<unknown>;
  resolveComment(crNumber: number, threadId: string, resolved?: boolean): Promise<unknown>;
  /** Post a note into an existing discussion thread; returns the created note. */
  replyToComment(crNumber: number, threadId: string, body: string): Promise<HostNote>;
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
  configured(): Promise<boolean>;
  /** True when this host has credentials for the given repo URL. */
  ownsRepo(repoUrl: string): Promise<boolean>;
  /** API client bound to the instance that owns the given repo URL. */
  clientForRepo(repoUrl: string): Promise<GitHostClient>;
  /** Plain HTTPS clone/push URL (credentials supplied via gitAuthEnv). */
  authedCloneUrl(repoUrl: string): Promise<string>;
  /** `GIT_CONFIG_*` env for HTTPS auth without embedding tokens in URLs. */
  gitAuthEnv(repoUrl: string): Promise<Record<string, string>>;
  /** Secret values to strip from git error text for this repo. */
  gitRedactValues(repoUrl: string): Promise<readonly string[]>;

  // ── instance registry (settings admin) ───────────────────────────────────
  instances(): Promise<HostInstance[]>;
  addInstance(input: { name?: string | null; baseUrl: string; token: string }): Promise<HostInstance>;
  /** Update by id; a blank/absent token keeps the stored one. */
  updateInstance(id: string, input: { name?: string | null; baseUrl?: string; token?: string }): Promise<void>;
  removeInstance(id: string): Promise<void>;
  /**
   * Quick reachability/auth check used by the settings page — tests the
   * stored instance's credentials, with optional overrides (e.g. the form
   * values before saving).
   */
  testInstance(id: string, input?: { baseUrl?: string; token?: string }): Promise<{ ok: boolean; detail: string }>;

  // ── webhook ingestion ────────────────────────────────────────────────────
  /**
   * True when the delivery's `x-gitlab-token` matches `GITLAB_WEBHOOK_SECRET`,
   * or when unsigned deliveries are explicitly allowed (`GITLAB_WEBHOOK_ALLOW_UNSIGNED=1`).
   */
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
  createInlineComment(
    repoUrl: string,
    crNumber: number,
    input: InlineCommentInput,
    positionContext: InlineCommentPositionContext,
  ): Promise<unknown>;
  resolveComment(repoUrl: string, crNumber: number, threadId: string, resolved?: boolean): Promise<unknown>;
  /** Post a note into an existing discussion thread; returns the created note. */
  replyToComment(repoUrl: string, crNumber: number, threadId: string, body: string): Promise<HostNote>;
  getProject(repoUrl: string): Promise<HostProject>;
}
