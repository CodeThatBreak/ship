/**
 * In-memory {@link GitHostService} for engine characterization tests (engine
 * overhaul step 00). One instance per test file; registered into the global
 * `gitHostRegistry` by {@link registerFakeGitHost}.
 *
 * The fake scripts the host surface the engine reads — change requests, head
 * pipelines, comments — and records every write (create CR / pipeline /
 * comment / resolve) so tests assert at the port boundary. It claims every
 * repo URL (`ownsRepo` always true) so it wins `forRepo` resolution.
 */
import type {
  ChangeRequest,
  ChangeRequestDiffs,
  CreateChangeRequestInput,
  GitHostClient,
  GitHostService,
  HeadPipelineInfo,
  HostComment,
  HostInstance,
  HostJob,
  HostNote,
  HostProject,
  HostWebhookEvent,
  InlineCommentInput,
  InlineCommentPositionContext,
  Pipeline,
} from "@/lib/engine/ports/gitHost";
import { gitHostRegistry } from "@/lib/engine/ports/gitHost";

export type GitHostCall =
  | { kind: "createChangeRequest"; input: CreateChangeRequestInput; repoUrl: string }
  | { kind: "createPipeline"; ref: string; repoUrl: string }
  | { kind: "createCRPipeline"; crNumber: number; repoUrl: string }
  | { kind: "createComment"; crNumber: number; body: string; repoUrl: string }
  | { kind: "createInlineComment"; crNumber: number; input: InlineCommentInput; repoUrl: string }
  | { kind: "resolveComment"; crNumber: number; threadId: string; resolved: boolean; repoUrl: string }
  | { kind: "replyToComment"; crNumber: number; threadId: string; body: string; repoUrl: string }
  | { kind: "retryPipeline"; pipelineId: number; repoUrl: string }
  | { kind: "playJob"; jobId: number; repoUrl: string };

export class FakeGitHost implements GitHostService {
  readonly kind = "fake-git-host";
  readonly label = "Fake git host";

  readonly calls: GitHostCall[] = [];
  /** MRs keyed by host number; `mr.state` flips to "merged" via mergeMr(). */
  readonly changeRequests = new Map<number, ChangeRequest>();
  /** Pipelines keyed by id; `setPipelineStatus` scripts what getPipeline returns. */
  readonly pipelines = new Map<number, Pipeline>();
  /** Review comments keyed by CR number (listComments' answer). */
  readonly comments = new Map<number, HostComment[]>();

  private mrCounter = 0;
  private pipelineCounter = 0;
  private noteCounter = 0;

  // ── scripting surface (test-side) ─────────────────────────────────────────

  /** Register an MR the engine should see; returns its host number. */
  addChangeRequest(partial: Partial<ChangeRequest> & { sourceBranch?: string }): number {
    this.mrCounter += 1;
    const number = partial.number ?? this.mrCounter;
    const cr: ChangeRequest = {
      id: `mr_${number}`,
      number,
      title: partial.title ?? `fake MR ${number}`,
      state: partial.state ?? "opened",
      webUrl: partial.webUrl ?? `https://git.example.com/o/r/-/merge_requests/${number}`,
      sourceBranch: partial.sourceBranch ?? `devflow/fake-${number}`,
      targetBranch: partial.targetBranch ?? "main",
      sha: partial.sha ?? `sha_${number}`,
      headPipeline: partial.headPipeline ?? null,
      projectId: partial.projectId ?? 1,
      diffRefs: partial.diffRefs ?? null,
    };
    this.changeRequests.set(number, cr);
    return number;
  }

  /** Attach a pipeline to an MR's head and script its status (the pipeline's
   *  sha matches the MR head sha so the gate classifies it current, not stale). */
  setHeadPipeline(crNumber: number, status: string): number {
    const cr = this.changeRequests.get(crNumber);
    if (!cr) throw new Error(`FakeGitHost: unknown MR ${crNumber}`);
    const id = this.addPipeline(status, cr.sha);
    const head: HeadPipelineInfo = { id, status, webUrl: `https://git.example.com/p/${id}` };
    cr.headPipeline = head;
    return id;
  }

  addPipeline(status: string, sha = "sha_head"): number {
    this.pipelineCounter += 1;
    const id = this.pipelineCounter;
    this.pipelines.set(id, {
      id,
      status,
      ref: "main",
      sha,
      webUrl: `https://git.example.com/p/${id}`,
    });
    return id;
  }

  /** Script what a subsequent getPipeline() returns. */
  setPipelineStatus(pipelineId: number, status: string): void {
    const p = this.pipelines.get(pipelineId);
    if (!p) throw new Error(`FakeGitHost: unknown pipeline ${pipelineId}`);
    this.pipelines.set(pipelineId, { ...p, status });
    for (const cr of this.changeRequests.values()) {
      if (cr.headPipeline?.id === pipelineId) cr.headPipeline = { ...cr.headPipeline, status };
    }
  }

  /** Seed open review comments on an MR (the resolve loop's input). */
  setComments(crNumber: number, comments: HostComment[]): void {
    this.comments.set(crNumber, comments);
  }

  /** Flip an MR to merged (the "side effect already landed" reconcile case). */
  mergeMr(crNumber: number): void {
    const cr = this.changeRequests.get(crNumber);
    if (!cr) throw new Error(`FakeGitHost: unknown MR ${crNumber}`);
    this.changeRequests.set(crNumber, { ...cr, state: "merged" });
  }

  // ── service-level plumbing (all thin delegations + recording) ─────────────

  configured(): boolean {
    return true;
  }

  ownsRepo(): boolean {
    return true; // wins every forRepo() in the test file
  }

  clientForRepo(): GitHostClient {
    return this.client;
  }

  authedCloneUrl(repoUrl: string): string {
    return repoUrl;
  }

  gitAuthEnv(): Record<string, string> {
    return {};
  }

  gitRedactValues(): readonly string[] {
    return [];
  }

  instances(): HostInstance[] {
    return [];
  }

  addInstance(): HostInstance {
    throw new Error("FakeGitHost: instance admin is not scripted");
  }

  updateInstance(): void {
    throw new Error("FakeGitHost: instance admin is not scripted");
  }

  removeInstance(): void {
    throw new Error("FakeGitHost: instance admin is not scripted");
  }

  async testInstance(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: "fake" };
  }

  verifyWebhook(): boolean {
    return true;
  }

  parseWebhook(): HostWebhookEvent | null {
    return null;
  }

  // ── repo-scoped surface (what engine code calls) ─────────────────────────

  private readonly client: GitHostClient = {
    getChangeRequest: async (crNumber) => this.requireCr(crNumber),
    createChangeRequest: async (input) => {
      this.calls.push({ kind: "createChangeRequest", input, repoUrl: "" });
      const number = this.addChangeRequest({
        title: input.title,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
      });
      return this.requireCr(number);
    },
    listChangeRequestsByBranch: async (sourceBranch) =>
      [...this.changeRequests.values()].filter((cr) => cr.sourceBranch === sourceBranch),
    getChanges: async (): Promise<ChangeRequestDiffs> => ({ changes: [], truncated: false }),
    getPipeline: async (pipelineId) => {
      const p = this.pipelines.get(pipelineId);
      if (!p) throw new Error(`FakeGitHost: unknown pipeline ${pipelineId}`);
      return p;
    },
    createCRPipeline: async (crNumber) => {
      this.calls.push({ kind: "createCRPipeline", crNumber, repoUrl: "" });
      const id = this.addPipeline("created");
      return this.requirePipeline(id);
    },
    createPipeline: async (ref) => {
      this.calls.push({ kind: "createPipeline", ref, repoUrl: "" });
      const id = this.addPipeline("created");
      return this.requirePipeline(id);
    },
    listPipelineJobs: async (): Promise<HostJob[]> => [],
    playJob: async (jobId) => {
      this.calls.push({ kind: "playJob", jobId, repoUrl: "" });
      return {};
    },
    retryPipeline: async (pipelineId) => {
      this.calls.push({ kind: "retryPipeline", pipelineId, repoUrl: "" });
      return this.requirePipeline(pipelineId);
    },
    getJobTrace: async () => "",
    listComments: async (crNumber) => this.comments.get(crNumber) ?? [],
    createComment: async (crNumber, body) => {
      this.calls.push({ kind: "createComment", crNumber, body, repoUrl: "" });
      return {};
    },
    createInlineComment: async (crNumber, input, positionContext: InlineCommentPositionContext) => {
      void positionContext;
      this.calls.push({ kind: "createInlineComment", crNumber, input, repoUrl: "" });
      return {};
    },
    resolveComment: async (crNumber, threadId, resolved = true) => {
      this.calls.push({ kind: "resolveComment", crNumber, threadId, resolved, repoUrl: "" });
      return {};
    },
    replyToComment: async (crNumber, threadId, body): Promise<HostNote> => {
      this.calls.push({ kind: "replyToComment", crNumber, threadId, body, repoUrl: "" });
      this.noteCounter += 1;
      return { id: `note_${this.noteCounter}`, author: "fake-bot", createdAt: new Date().toISOString() };
    },
    getProject: async (): Promise<HostProject> => ({ id: 1, webUrl: "https://git.example.com/o/r" }),
  };

  private requireCr(crNumber: number): ChangeRequest {
    const cr = this.changeRequests.get(crNumber);
    if (!cr) throw new Error(`FakeGitHost: unknown MR ${crNumber}`);
    return cr;
  }

  private requirePipeline(pipelineId: number): Pipeline {
    const p = this.pipelines.get(pipelineId);
    if (!p) throw new Error(`FakeGitHost: unknown pipeline ${pipelineId}`);
    return p;
  }

  // GitHostService repo-scoped methods delegate to the bound client. The
  // repoUrl is recorded on write calls (the fake is single-tenant).
  getChangeRequest(_repoUrl: string, crNumber: number) {
    return this.client.getChangeRequest(crNumber);
  }
  createChangeRequest(repoUrl: string, input: CreateChangeRequestInput) {
    return this.client.createChangeRequest(input).then((cr) => {
      const last = this.calls[this.calls.length - 1];
      if (last?.kind === "createChangeRequest") last.repoUrl = repoUrl;
      return cr;
    });
  }
  listChangeRequestsByBranch(repoUrl: string, sourceBranch: string) {
    void repoUrl;
    return this.client.listChangeRequestsByBranch(sourceBranch);
  }
  getChanges(repoUrl: string, crNumber: number) {
    void repoUrl;
    return this.client.getChanges(crNumber);
  }
  getPipeline(repoUrl: string, pipelineId: number) {
    void repoUrl;
    return this.client.getPipeline(pipelineId);
  }
  createCRPipeline(repoUrl: string, crNumber: number) {
    void repoUrl;
    return this.client.createCRPipeline(crNumber);
  }
  createPipeline(repoUrl: string, ref: string) {
    void repoUrl;
    return this.client.createPipeline(ref);
  }
  listPipelineJobs(repoUrl: string, pipelineId: number) {
    void repoUrl;
    return this.client.listPipelineJobs(pipelineId);
  }
  playJob(repoUrl: string, jobId: number) {
    void repoUrl;
    return this.client.playJob(jobId);
  }
  retryPipeline(repoUrl: string, pipelineId: number) {
    void repoUrl;
    return this.client.retryPipeline(pipelineId);
  }
  getJobTrace(repoUrl: string, jobId: number) {
    void repoUrl;
    return this.client.getJobTrace(jobId);
  }
  listComments(repoUrl: string, crNumber: number) {
    void repoUrl;
    return this.client.listComments(crNumber);
  }
  createComment(repoUrl: string, crNumber: number, body: string) {
    void repoUrl;
    return this.client.createComment(crNumber, body);
  }
  createInlineComment(
    repoUrl: string,
    crNumber: number,
    input: InlineCommentInput,
    positionContext: InlineCommentPositionContext,
  ) {
    void repoUrl;
    return this.client.createInlineComment(crNumber, input, positionContext);
  }
  resolveComment(repoUrl: string, crNumber: number, threadId: string, resolved?: boolean) {
    void repoUrl;
    return this.client.resolveComment(crNumber, threadId, resolved);
  }
  replyToComment(repoUrl: string, crNumber: number, threadId: string, body: string) {
    void repoUrl;
    return this.client.replyToComment(crNumber, threadId, body);
  }
  getProject(repoUrl: string) {
    void repoUrl;
    return this.client.getProject();
  }
}

/**
 * Register a fresh fake into the global git-host registry. The registry
 * singleton forbids duplicate kinds, so one call per test file (top level,
 * matching the repo's existing stub-port convention).
 */
export const registerFakeGitHost = (): FakeGitHost => {
  const fake = new FakeGitHost();
  gitHostRegistry.register(fake);
  return fake;
};
