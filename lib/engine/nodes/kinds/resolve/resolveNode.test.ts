/**
 * ResolveNode behaviors beyond the chat seam (chatFirstTurn.test.ts owns
 * those): the §6 contract retry (ONE feedback follow-up on the same session,
 * then a failed node), §6A push-state verification (the `unknown` error path)
 * and the engine push (§6A: local_only flush at finalize, hook rejection ⇒
 * one fix turn then one re-push, infra failure degrades), cloud mode
 * verifying on MR-head movement alone, and restart recovery completing the
 * remaining ledgered effects (§6 layer 4).
 *
 * Runs against an isolated temp SQLite DB with real `NodeSupport` rows — the
 * node reads the artifact ledger back — and a stubbed `AgentRunner` riding
 * the same seam production code uses (agentNode.test.ts precedent; AGENTS.md
 * §1 — never a real database). Imports hoist — dynamic imports keep the
 * evaluation order.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-resolve-node-")),
  "test.db",
);

const { db } = await import("../../../../db/app");
// registry first — it pulls the node kinds (and their prompt assemblies) in
// ahead of everything else; direct kind imports later then hit a live module
await import("../../registry");
const { NodeSupport } = await import("../../shared/nodeSupport");
const { ResolveNode } = await import("./resolveNode");
const { ResolveEffects } = await import("./resolveEffects");
const { worktreeManager } = await import("../../../runtime/worktreeLifecycle");
const { localGit } = await import("../../../../git/local");
const { PUSH_STATE } = await import("./constants/pushState");
import type { AgentRunner } from "../../../harness/harnessExports";
import type { LocalBranchState } from "../../../../git/local";
import type { FlowCtx, FlowContextHelper } from "../../shared/nodeSharedExports";
import type { AgentRunResult } from "../../../ports/agentPort";
import type { GitHostResolver } from "../../../ports/gitHost";
import type { ResolveAgentResponse } from "./schema";
import type { ResolveEffectLedger } from "./types/resolveEffects";

type NodeSupport = import("../../shared/nodeSupport").NodeSupport;
type ResolveNode = import("./resolveNode").ResolveNode;

const now = () => new Date().toISOString();

// ── fixtures ─────────────────────────────────────────────────────────────────

const REPO_URL = "https://gitlab.example/g/p";

const ctx: FlowCtx = {
  flow: {
    id: "flw_rn",
    task_id: "task_rn",
    name: "resolve node test",
    status: "active",
    execution_mode: "cloud",
    mr_iid: 7,
    mr_branch: "feature/x",
    repo_url: REPO_URL,
  },
  task: {
    id: "task_rn",
    type: "generic",
    key: "T-RN",
    summary: "resolve node test",
    fields: {},
    status: "open",
    issueType: "story",
    priority: "P2",
  },
  repo: { default_branch: "main" },
} as unknown as FlowCtx;

/** `localPath()` decides the mode: set it (with the worktree + git spies)
 *  before a run to make the flow local-mode. */
let localPathValue: string | undefined = undefined;

const ctxHelper = {
  taskLabel: () => "story",
  taskContext: () => "T-RN context",
  execMode: () => (localPathValue ? "local" : "cloud"),
  localPath: () => localPathValue,
  requireRunCwd: () => undefined,
  makeDiff: async () => ({ raw: "diff raw", stat: "+1 -1" }),
} as unknown as FlowContextHelper;

const seedFlow = () => {
  // idempotent seed + per-test state reset: the file runs against ONE sqlite
  // file across tests, so flow-owned state (comments, artifacts, runs, events,
  // the node row) is cleared and the static rows are re-inserted safely
  db.run(`INSERT OR IGNORE INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    "task_rn", "generic", "T-RN", "resolve node test", "open", "story", "P2",
  );
  db.run(`INSERT OR IGNORE INTO flows (id, task_id, name, status, mr_iid, mr_branch, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    "flw_rn", "task_rn", "resolve node test", "active", 7, "feature/x", now(), now(),
  );
  db.run(`INSERT OR IGNORE INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    "node_rn", "flw_rn", "resolve", "resolve", "running", now(), now(),
  );
  db.run(`DELETE FROM comments WHERE flow_id='flw_rn'`);
  db.run(`DELETE FROM events WHERE flow_id='flw_rn'`);
  db.run(`DELETE FROM runs WHERE node_id='node_rn'`);
  db.run(`DELETE FROM artifacts WHERE node_id='node_rn'`);
  db.run(`UPDATE nodes SET status='running', input=NULL, output=NULL, attempt_id=NULL WHERE id='node_rn'`);
};

const seedComment = (id: string, discussionId = `d_${id}`) =>
  db.run(
    `INSERT INTO comments (id, flow_id, mr_iid, discussion_id, author, body, file_path, line, status, raw, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, "flw_rn", 7, discussionId, "reviewer", "Rename the badly named variable.",
    "src/a.ts", 2, "open", null, now(), now(),
  );

interface Journal {
  startAgentInputs: Record<string, unknown>[];
  labels: string[];
}

const newJournal = (): Journal => ({ startAgentInputs: [], labels: [] });

/** Runner stub mirroring the real runner's persistence contract (one run row
 *  per start, so `lastAgentId`/`followUpOn` work), answering one result per
 *  executeRun. */
const stubRunner = (support: NodeSupport, j: Journal, responses: string[]): AgentRunner =>
  ({
    startAgent: (_c: FlowCtx, input: unknown) => {
      j.startAgentInputs.push(input as never);
      const agentId = `agent_${j.startAgentInputs.length}`;
      support.persistRun("flw_rn", "node_rn", agentId, `run_${j.startAgentInputs.length}`);
      return Promise.resolve({ agentId, runId: `run_${j.startAgentInputs.length}` });
    },
    executeRun: (_c: FlowCtx, _n: string, start: () => Promise<unknown>, label: string) => {
      j.labels.push(label);
      return start().then(() => ({
        result: {
          status: "finished",
          result: responses.shift() ?? "",
          sessionId: "session_1",
          durationMs: 1,
          usage: null,
        },
        runRowId: `run_row_${j.labels.length}`,
      }));
    },
  }) as unknown as AgentRunner;

const contractResponse = (): ResolveAgentResponse => ({
  summary: "renamed the variable",
  codeChanged: true,
  decisions: [{ id: "gl_1", action: "fixed", reply: "renamed badlyNamedValue", resolve: true }],
});

const make = (
  responses: string[],
  host: FakeResolveHost,
): { def: ResolveNode; j: Journal } => {
  const support = new NodeSupport();
  const j = newJournal();
  const def = new ResolveNode(
    support,
    stubRunner(support, j, responses),
    ctxHelper,
    hostResolver(host),
  );
  return { def, j };
};

const runInput = {
  instructions: null,
  prompt: null,
  promptIsBody: false,
  branchName: null,
  model: null,
};

// ── scripted fake host ───────────────────────────────────────────────────────

/**
 * Head-SHA reads are FIFO — the first call consumes the first value and every
 * later read repeats the last one, so "same SHA across the reads" and "the
 * head moved" both encode in one line. `readError` makes every read throw
 * (the G6 error path; captureState swallows it, verifyPushState surfaces it).
 * Reply/resolve calls are journaled.
 */
class FakeResolveHost {
  readonly shas: string[];
  readError: Error | null = null;
  readonly replyCalls: { threadId: string; body: string }[] = [];
  readonly resolveCalls: string[] = [];

  constructor(shas: string[]) {
    this.shas = [...shas];
  }

  async getChangeRequest(): Promise<{ sha: string }> {
    if (this.readError) throw this.readError;
    const sha = this.shas.length > 1 ? (this.shas.shift() ?? "sha_0") : (this.shas[0] ?? "sha_0");
    return { sha };
  }

  async replyToComment(_r: string, _i: number, threadId: string, body: string) {
    this.replyCalls.push({ threadId, body });
    return { id: `gl_note_${this.replyCalls.length + 1}`, author: "devflow-bot", createdAt: now() };
  }

  async resolveComment(_r: string, _i: number, threadId: string) {
    this.resolveCalls.push(threadId);
    return {};
  }
}

const hostResolver = (host: FakeResolveHost): GitHostResolver =>
  ({ forRepo: () => host }) as unknown as GitHostResolver;

// ── git / worktree seam stubs ────────────────────────────────────────────────

const fullBranchState = (over: Partial<LocalBranchState>): LocalBranchState => ({
  exists: true,
  commitsAhead: 1,
  commitsBehind: 0,
  unpushedAhead: 0,
  base: "origin/main",
  stat: "stat_0",
  raw: "raw",
  pushed: true,
  ...over,
});

const stubWorktree = (): void => {
  vi.spyOn(worktreeManager, "ensureFlowWorktree").mockResolvedValue({
    dir: "/wt/resolve",
    setupNote: null,
  });
};

/** FIFO local states; every read past the list repeats the last one (the
 *  capture → pre-run check → verify call order thus encodes in one line). */
const stubLocalStates = (...states: LocalBranchState[]): void => {
  let call = 0;
  vi.spyOn(localGit, "localBranchState").mockImplementation(async () =>
    states.length > 1 ? states[Math.min(call++, states.length - 1)] : states[0],
  );
};

/**
 * Advance the resolve run past `verifyPushState`'s bounded recheck (a real
 * 5s sleep is pointless under test): the run promise spins while fake timers
 * flush every pending timer. Rejections propagate.
 */
const withFlushedTimers = async (run: () => Promise<unknown>): Promise<unknown> => {
  vi.useFakeTimers();
  try {
    const pending = run();
    await vi.advanceTimersByTimeAsync(30_000);
    return await pending;
  } finally {
    vi.useRealTimers();
  }
};

const eventsByType = (type: string) =>
  db.all<{ type: string; message: string }>(
    `SELECT type, message FROM events WHERE flow_id='flw_rn' AND type=? ORDER BY created_at ASC`,
    type,
  );

const nodeOutputRecord = (): Record<string, unknown> => {
  const raw = db.get<{ output: string | null }>(`SELECT output FROM nodes WHERE id='node_rn'`)?.output;
  return (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
};

const commentStatus = (id: string): { status: string } | undefined =>
  db.get<{ status: string }>(`SELECT status FROM comments WHERE id=?`, id);

beforeEach(() => {
  seedFlow();
});
afterEach(() => {
  vi.restoreAllMocks();
  localPathValue = undefined;
});

// ── §6 layer 1: the contract retry ──────────────────────────────────────────

describe("ResolveNode — the contract retry (§6 layer 1)", () => {
  it("a retryable miss gets exactly ONE feedback follow-up; a second miss fails the node", async () => {
    const host = new FakeResolveHost(["sha_before"]);
    const { def, j } = make(["nothing to parse here", "still no JSON object"], host);
    seedComment("gl_1");

    await expect(def.run(ctx, runInput, {})).rejects.toThrow(/contained no JSON/i);

    // one main turn + exactly one bounded feedback turn
    expect(j.startAgentInputs).toHaveLength(2);
    expect(j.labels).toEqual(["resolve", "resolve contract retry"]);
    // the feedback re-runs on the SAME agent session
    expect(j.startAgentInputs[1]?.followUpOn).toBe("agent_1");
    // the lifecycle trail names the retry; nothing on the host was touched
    expect(eventsByType("lifecycle").some((e) => e.message.includes("one retry with feedback"))).toBe(true);
    expect(host.resolveCalls).toEqual([]);
  });
});

// ── §6 layer 3: push-state verification (§6A / G6) ──────────────────────────

describe("ResolveNode — verifyPushState", () => {
  it("an unreadable MR head yields unknown: threads stay open and the error is loud (G6)", async () => {
    const host = new FakeResolveHost(["sha_before"]);
    host.readError = new Error("401 unverified");
    const { def } = make(
      [
        JSON.stringify({
          summary: "answered the question",
          codeChanged: false,
          decisions: [{ id: "gl_1", action: "answered", reply: "two clients, one per surface", resolve: false }],
        }),
      ],
      host,
    );
    seedComment("gl_1");

    await withFlushedTimers(() => def.run(ctx, runInput, {}));

    // unknown ⇒ no resolution authority: the answer posts, the thread stays open
    expect(host.resolveCalls).toEqual([]);
    expect(commentStatus("gl_1")).toEqual({ status: "open" });
    expect(eventsByType("error").some((e) => e.message.includes("could not verify the MR head"))).toBe(true);
    expect(nodeOutputRecord()).toMatchObject({ pushed: false, resolved: 0, codeChanged: false, hostFailures: 0 });
  });
});

// ── §6A: cloud mode verifies on MR-head movement alone ──────────────────────

describe("ResolveNode — cloud mode (§6A)", () => {
  it("pushes nothing locally: `pushed` comes from MR-head movement only", async () => {
    const host = new FakeResolveHost(["sha_before", "sha_after"]);
    const pushSpy = vi.spyOn(localGit, "pushBranch");
    const { def, j } = make([JSON.stringify(contractResponse())], host);
    seedComment("gl_1");

    await withFlushedTimers(() => def.run(ctx, runInput, {}));

    // no local path exists in cloud mode — the cloud agent owns pushing
    expect(pushSpy).not.toHaveBeenCalled();
    expect(j.labels).toEqual(["resolve"]); // no hook-fix turn either
    expect(host.resolveCalls).toEqual(["d_gl_1"]);
    expect(nodeOutputRecord()).toMatchObject({ resolved: 1, replied: 1, codeChanged: true, pushed: true });
  });
});

// ── §6A: the engine push in local mode ──────────────────────────────────────

describe("ResolveNode — the engine push (§6A)", () => {
  it("local_only commits are pushed in finalize; threads close once the fix is on the MR", async () => {
    localPathValue = "/repo/checkout";
    stubWorktree();
    // capture + the pre-run check see a synced branch; the post-run verify
    // sees the agent's new local commits the remote branch lacks
    stubLocalStates(
      fullBranchState({ stat: "stat_a", unpushedAhead: 0 }),
      fullBranchState({ stat: "stat_a", unpushedAhead: 0 }),
      fullBranchState({ stat: "stat_b", unpushedAhead: 2 }),
    );
    const pushSpy = vi.spyOn(localGit, "pushBranch").mockResolvedValue("origin");
    const host = new FakeResolveHost(["sha_before"]);
    const { def } = make([JSON.stringify(contractResponse())], host);
    seedComment("gl_1");

    await withFlushedTimers(() => def.run(ctx, runInput, {}));

    // exactly one engine push — the finalize one (no pre-run backlog this cycle)
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(host.resolveCalls).toEqual(["d_gl_1"]);
    expect(nodeOutputRecord()).toMatchObject({ resolved: 1, replied: 1, codeChanged: true, pushed: true });
    expect(db.get<{ status: string }>(`SELECT status FROM nodes WHERE id='node_rn'`)).toEqual({ status: "done" });
  });

  it("a hook rejection gets ONE agent fix turn then one re-push; a second rejection fails the node", async () => {    localPathValue = "/repo/checkout";
    stubWorktree();
    stubLocalStates(
      fullBranchState({ stat: "stat_a", unpushedAhead: 0 }),
      fullBranchState({ stat: "stat_a", unpushedAhead: 0 }),
      fullBranchState({ stat: "stat_b", unpushedAhead: 1 }),
    );
    const rejections = [
      new Error("! [remote rejected] feature/x -> feature/x (pre-receive hook declined)"),
      new Error("! [remote rejected] feature/x -> feature/x (pre-receive hook declined)"),
    ];
    const pushSpy = vi.spyOn(localGit, "pushBranch").mockImplementation(async () => {
      const error = rejections.shift();
      if (error) throw error;
      return "origin";
    });
    const host = new FakeResolveHost(["sha_before"]);
    const { def, j } = make([JSON.stringify(contractResponse())], host);
    seedComment("gl_1");

    await withFlushedTimers(async () => {
      await expect(def.run(ctx, runInput, {})).rejects.toThrow(
        /hooks rejected branch feature\/x again after the fix turn/,
      );
    });

    // exactly one bounded fix turn carrying the hook output, then the re-push
    expect(j.startAgentInputs).toHaveLength(2);
    const fixPrompt = String(j.startAgentInputs[1]?.prompt);
    expect(fixPrompt).toContain("rejected by a repository hook");
    expect(fixPrompt).toContain("pre-receive hook declined");
    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect(host.resolveCalls).toEqual([]); // the run failed before any effect
  });

  it("an infra push failure degrades, not fails: replies post, threads stay open, pushed=false", async () => {
    localPathValue = "/repo/checkout";
    stubWorktree();
    stubLocalStates(
      fullBranchState({ stat: "stat_a", unpushedAhead: 0 }),
      fullBranchState({ stat: "stat_a", unpushedAhead: 0 }),
      fullBranchState({ stat: "stat_b", unpushedAhead: 2 }),
    );
    vi.spyOn(localGit, "pushBranch").mockRejectedValue(
      new Error("ssh: connect to host gitlab.example port 22: No route to host"),
    );
    const host = new FakeResolveHost(["sha_before"]);
    const { def } = make([JSON.stringify(contractResponse())], host);
    seedComment("gl_1");

    await withFlushedTimers(() => def.run(ctx, runInput, {}));

    // the agent's work is real: the run completes, the reply posts…
    expect(host.replyCalls).toHaveLength(1);
    expect(host.resolveCalls).toEqual([]); // …but a local-only fix never closes
    expect(commentStatus("gl_1")).toEqual({ status: "open" });
    expect(nodeOutputRecord()).toMatchObject({ resolved: 0, replied: 1, pushed: false, hostFailures: 0 });
    expect(db.get<{ status: string }>(`SELECT status FROM nodes WHERE id='node_rn'`)).toEqual({ status: "done" });
    // …and the failure names the push, not the node
    expect(
      eventsByType("error").some((e) => e.message.includes("push of branch feature/x failed")),
    ).toBe(true);
  });
});

// ── §6 layer 4: restart recovery ────────────────────────────────────────────

describe("ResolveNode — recover()", () => {
  const emptyLedger: ResolveEffectLedger = { replies: [], resolvedDiscussions: [] };
  const finishedResult = (text: string): AgentRunResult => ({
    status: "finished",
    result: text,
    sessionId: "session_crash",
    durationMs: 1,
    usage: null,
  });

  it("re-applies the recorded result and completes the remaining ledgered effects", async () => {
    seedComment("gl_1");
    const support = new NodeSupport();
    const response = contractResponse();

    // the pre-crash host answers the reply, then dies on the threaded resolve
    let preCrashResolveFails = 1;
    const crashedHost = {
      replyToComment: async () => ({ id: "gl_note_1", author: "devflow-bot", createdAt: now() }),
      resolveComment: async () => {
        if (preCrashResolveFails > 0) {
          preCrashResolveFails -= 1;
          throw new Error("host down mid-finalize");
        }
        return {};
      },
    };

    // simulate the interrupted run at the effects layer: the reply landed and
    // is journaled into the artifact's persistProgress (with the pre-crash
    // verify), then the process died before the threaded resolve landed
    await new ResolveEffects(support, { forRepo: () => crashedHost } as unknown as GitHostResolver).apply({
      flowId: "flw_rn",
      nodeId: "node_rn",
      repoUrl: REPO_URL,
      mrIid: 7,
      response,
      open: support.openComments("flw_rn", 7),
      pushState: PUSH_STATE.PUSHED,
      ledger: emptyLedger,
      persistProgress: (ledger: ResolveEffectLedger) =>
        support.saveArtifact("node_rn", "flw_rn", "resolve", "summary", {
          ledger,
          pushState: PUSH_STATE.PUSHED,
          codeChanged: true,
        }),
    });
    expect(commentStatus("gl_1")).toEqual({ status: "open" });

    // the host recovers with the restart: the recovery side closes the thread
    const recoveredHost = new FakeResolveHost(["sha_before"]);
    const def = new ResolveNode(
      support,
      {
        startAgent: async () => ({ agentId: "agent_1", runId: "run_1" }),
        executeRun: async () => ({ result: finishedResult(""), runRowId: "run_row_recovery" }),
      } as unknown as AgentRunner,
      ctxHelper,
      hostResolver(recoveredHost),
    );

    const ok = await def.recover(
      ctx,
      support.nodeByKey("flw_rn", "resolve"),
      finishedResult(JSON.stringify(response)),
      "server restarted mid-finalize",
    );

    expect(ok).toBe(true);
    expect(commentStatus("gl_1")).toEqual({ status: "resolved" });
    expect(recoveredHost.resolveCalls).toEqual(["d_gl_1"]);
    // the ledgered reply is NOT posted again (replied stays 0)
    expect(nodeOutputRecord()).toMatchObject({ resolved: 1, replied: 0, pushed: true });
    expect(
      eventsByType("lifecycle").some((e) => e.message.includes("recovered: server restarted mid-finalize")),
    ).toBe(true);
  });
});
