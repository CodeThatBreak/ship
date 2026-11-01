/**
 * First-turn chat = prompt-body run (docs/make-agentic-node-consistent.md
 * Phase 1): the composer's first message on a never-run node IS the node's
 * prompt — review/resolve/pipeline/build map it into the typed
 * `promptIsBody` input the retired prompt modal produced, and internal blocks
 * re-append at run time; turns after a run stay the refine mapping
 * (instructions / guidance / feedback).
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database). Imports hoist — dynamic
 * imports keep the registry's evaluation order.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-chat-first-turn-")),
  "test.db",
);

await import("./registry");
const { ReviewNode } = await import("./kinds/review/reviewNode");
const { ResolveNode } = await import("./kinds/resolve/resolveNode");
const { PipelineNode } = await import("./kinds/pipeline/pipelineNode");
const { BuildNode } = await import("./kinds/build/buildNode");
const { PlanNode } = await import("./kinds/plan/planNode");
const { gitHostRegistry } = await import("../ports/gitHost");
type FlowCtx = import("./shared/nodeSharedExports").FlowCtx;
type FlowContextHelper = import("./shared/nodeSharedExports").FlowContextHelper;
type NodeSupport = import("./shared/nodeSupport").NodeSupport;
type NodeRow = import("../../db/rows").NodeRow;
type AgentRunner = import("../harness/harnessExports").AgentRunner;
type GitHostResolver = import("../ports/gitHost").GitHostResolver;

// ── shared stubs ─────────────────────────────────────────────────────────────

const ctx: FlowCtx = {
  flow: {
    id: "flw_ft",
    task_id: "task_ft",
    name: "first turn",
    status: "active",
    execution_mode: "cloud",
    mr_iid: 7,
    mr_branch: "feature/x",
    repo_url: "https://gitlab.example/g/p",
  },
  task: {
    id: "task_ft",
    type: "generic",
    key: "T-FT",
    summary: "first turn contract",
    fields: {},
    status: "open",
    issueType: "story",
    priority: "P2",
  },
  repo: { default_branch: "main" },
} as unknown as FlowCtx;

/** Cloud-mode context helper — no worktree, no local git, a stubbed diff. */
const ctxHelper = {
  taskLabel: () => "story",
  taskContext: () => "T-FT context",
  execMode: () => "cloud",
  localPath: () => undefined,
  requireRunCwd: () => undefined,
  makeDiff: async () => ({ raw: "diff raw", stat: "+1 -1" }),
} as unknown as FlowContextHelper;

const nodeRow = (over: Partial<NodeRow> = {}): NodeRow =>
  ({
    id: "node_ft",
    flow_id: ctx.flow.id,
    node_key: "review",
    type: "review",
    status: "pending",
    attempt_id: null,
    agent_id: null,
    agent_ref: null,
    session_id: null,
    prompt_override: null,
    label: null,
    config: null,
    join_mode: null,
    input: null,
    output: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  }) as NodeRow;

interface Journal {
  startAgentInputs: { prompt: string; mode: string; followUpOn: string | null; model: string | null }[];
  labels: string[];
  nodePatches: Record<string, unknown>[];
}

const newJournal = (): Journal => ({
  startAgentInputs: [],
  labels: [],
  nodePatches: [],
});

/** Runner stub: answers one turn per entry in `resolutions`, journals both the
 *  startAgent inputs and the run labels. */
const stubRunner = (j: Journal, responses: string[]): AgentRunner =>
  ({
    startAgent: (_c: FlowCtx, input: unknown) => {
      j.startAgentInputs.push(input as never);
      return Promise.resolve({ agentId: "agent_1", runId: "run_1" });
    },
    executeRun: (_c: FlowCtx, _n: string, start: () => Promise<unknown>, label: string) => {
      j.labels.push(label);
      return start().then(() => ({
        result: {
          status: "finished",
          result: responses.shift(),
          sessionId: "session_1",
          durationMs: 1,
          usage: null,
        },
        runRowId: "run_row_test",
      }));
    },
  }) as unknown as AgentRunner;

/** Support stub: one fabricated node row; everything the run paths touch is
 *  journaled instead of persisted. */
const stubSupport = (j: Journal, node: NodeRow, opts: { openComments?: unknown[] } = {}): NodeSupport =>
  ({
    nodeByKey: () => node,
    setNode: (_id: string, patch: Record<string, unknown>) => {
      j.nodePatches.push(patch);
    },
    lastAgentId: () => "agent_1",
    emit: () => {},
    emitLifecycle: () => {},
    saveArtifact: () => ({ id: "art_stub_1" }),
    setFlowBranch: () => {},
    latestArtifact: () => null,
    nodeStatus: () => "running",
    branchMrIid: () => null,
    openComments: () => opts.openComments ?? [],
  }) as unknown as NodeSupport;

/** The run input blobs execute()/markRunning recorded, parsed. */
const recordedInputs = (j: Journal): Record<string, unknown>[] =>
  j.nodePatches
    .filter((p) => typeof p.input === "string")
    .map((p) => JSON.parse(p.input as string) as Record<string, unknown>);

/**
 * Advance the resolve run past `detectCodeChange`'s re-check delay (a real
 * 5s sleep is pointless under test): the chat promise runs while fake timers
 * let the re-check fire immediately.
 */
const withResolvedTimers = async (fn: () => Promise<string>): Promise<string> => {
  vi.useFakeTimers();
  try {
    const pending = fn();
    await vi.advanceTimersByTimeAsync(30_000);
    return await pending;
  } finally {
    vi.useRealTimers();
  }
};

// ── capabilities ─────────────────────────────────────────────────────────────

describe("capabilities — the composer-seam fields every agentic node publishes", () => {
  it("promptNode + startLabel ride the serializable UI projection", () => {
    for (const def of [
      new PlanNode(),
      new ReviewNode(),
      new ResolveNode(),
      new PipelineNode(),
      new BuildNode(),
    ]) {
      expect(def.capabilities.promptNode, def.key).toBe(def.key);
      expect(typeof def.capabilities.startLabel, def.key).toBe("string");
    }
  });
});

// ── review ──────────────────────────────────────────────────────────────────

describe("ReviewNode chat", () => {
  const make = (node: NodeRow, responses: string[]) => {
    const j = newJournal();
    const host = {
      getChanges: async () => ({
        changes: [{ oldPath: "a.ts", newPath: "a.ts", diff: "@@ -1 +1 @@" }],
        truncated: false,
      }),
      createComment: async () => ({}),
      getChangeRequest: async () => ({ sha: "sha_before" }),
    };
    const gitHosts = { forRepo: () => host } as unknown as GitHostResolver;
    const def = new ReviewNode(stubSupport(j, node), stubRunner(j, responses), ctxHelper, gitHosts);
    return { def, j };
  };

  it("first turn on a never-run node: the message IS the prompt body (internal blocks re-append)", async () => {
    const { def, j } = make(nodeRow(), ["hello"]);
    await def.chat(ctx, "Focus on the auth module and check the error paths.");
    expect(j.labels).toEqual(["review"]);
    expect(j.startAgentInputs[0]?.mode).toBe("agent");
    const turn = j.startAgentInputs[0] as unknown as { prompt: string };
    // the message rides the USER body...
    expect(turn.prompt).toContain("Focus on the auth module and check the error paths.");
    // ...and the run data re-appends after it (promptIsBody semantics)
    expect(turn.prompt).toContain("Ticket context:");
    expect(turn.prompt).toContain("@@ -1 +1 @@");
  });

  it("the recorded first-turn input blob is the prompt-body shape", async () => {
    const { def, j } = make(nodeRow(), ["hello"]);
    await def.chat(ctx, "Focus on the auth module.");
    expect(recordedInputs(j)[0]).toMatchObject({ promptIsBody: true, instructions: null });
  });

  it("a failed node with no output is still a first turn (the retry is a fresh body run)", async () => {
    const { def, j } = make(nodeRow({ status: "failed" }), ["hello"]);
    await def.chat(ctx, "Retry the review with a stricter focus.");
    expect((j.startAgentInputs[0] as unknown as { prompt: string }).prompt)
      .toContain("Retry the review with a stricter focus.");
    expect(recordedInputs(j)[0]).toMatchObject({ promptIsBody: true });
  });

  it("second turn after a run: the message is the instructions refine, no prompt body", async () => {
    const { def, j } = make(
      nodeRow({ status: "done", output: { comments: 2 }, agent_id: "agent_prev" }),
      ["hello"],
    );
    await def.chat(ctx, "Focus on naming");
    expect(recordedInputs(j)[0]).toMatchObject({
      instructions: "Focus on naming",
      promptIsBody: false,
    });
    const turn = j.startAgentInputs[0] as unknown as { prompt: string };
    expect(turn.prompt).toContain("Extra review focus from the developer: Focus on naming");
    expect(turn.prompt).toContain("@@ -1 +1 @@"); // diff run data still present
  });
});

// ── resolve ─────────────────────────────────────────────────────────────────

describe("ResolveNode chat", () => {
  const openComment = () => ({
    id: "c1",
    discussion_id: "d1",
    body: "Rename the badly named variable.",
    file_path: "a.ts",
    line: 2,
  });

  // resolve's before/after state capture goes through the gitHostRegistry
  // singleton — point it at a stub host for the test repo
  beforeEach(() => {
    vi.spyOn(gitHostRegistry, "forRepo").mockReturnValue(
      { getChangeRequest: async () => ({ sha: "sha_before" }) } as never,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const make = (node: NodeRow) => {
    const j = newJournal();
    const def = new ResolveNode(
      stubSupport(j, node, { openComments: [openComment()] }),
      stubRunner(j, ["rename done"]),
      ctxHelper,
    );
    return { def, j };
  };

  it("first turn on a never-run node: the message IS the prompt body with the comments re-appended", async () => {
    const { def, j } = make(nodeRow({ node_key: "resolve", type: "resolve" }));
    const reply = await withResolvedTimers(() => def.chat(ctx, "Start with the auth files."));
    expect(j.labels).toEqual(["resolve"]);
    const turn = j.startAgentInputs[0] as unknown as { prompt: string };
    expect(turn.prompt).toContain("Start with the auth files.");
    expect(turn.prompt).toContain("Rename the badly named variable."); // open-comments run data
    expect(recordedInputs(j)[0]).toMatchObject({ promptIsBody: true, instructions: null });
    expect(reply).toBe("rename done");
  });

  it("second turn after a run: the message is the instructions refine", async () => {
    const { def, j } = make(
      nodeRow({
        node_key: "resolve",
        type: "resolve",
        status: "done",
        output: { resolved: 1 },
        agent_id: "agent_prev",
      }),
    );
    await withResolvedTimers(() => def.chat(ctx, "Also improve naming"));
    expect(recordedInputs(j)[0]).toMatchObject({
      instructions: "Also improve naming",
      promptIsBody: false,
    });
    const turn = j.startAgentInputs[0] as unknown as { prompt: string };
    expect(turn.prompt).toContain("Developer instructions: Also improve naming");
  });
});

// ── pipeline ────────────────────────────────────────────────────────────────

describe("PipelineNode chat", () => {
  /** The gate's git host: a failed head pipeline that goes green after the
   *  fix run — the fix run is what records the assembled prompt. A short poll
   *  interval keeps the post-fix grace re-read inside the test timeout. */
  const make = (node: NodeRow) => {
    const j = newJournal();
    let getPipelineCalls = 0;
    const router = { forRepo: () => host } as unknown as GitHostResolver;
    const host = {
      getChangeRequest: async () => ({ headPipeline: { id: 77, status: "failed" } }),
      getPipeline: async () => {
        getPipelineCalls++;
        return { id: 77, status: getPipelineCalls === 1 ? "failed" : "success" };
      },
      listPipelineJobs: async () => [{ id: 1, name: "test", status: "failed" }],
      getJobTrace: async () => "boom — implementation error",
    };
    const def = new PipelineNode(
      // make(node): the node row carries a short poll interval (the gate
      // sleeps one interval between the fix push and the head re-read)
      stubSupport(j, { ...node, config: { poll_interval_sec: 1 } } as NodeRow),
      stubRunner(j, ["fixed the pipeline"]),
      ctxHelper,
      router,
    );
    return { def, j };
  };

  it("first turn on a never-run gate: the message IS the fix-run prompt body", async () => {
    const { def, j } = make(nodeRow({ node_key: "pipeline", type: "pipeline" }));
    const reply = await def.chat(ctx, "Sketch a fix for the failing test job.");
    expect(j.labels[0]).toContain("pipeline fix");
    const turn = j.startAgentInputs[0] as unknown as { prompt: string };
    expect(turn.prompt).toContain("Sketch a fix for the failing test job.");
    // the gate's run data re-appends: the failed-pipeline rules + job logs
    expect(turn.prompt).toContain("The CI/CD pipeline #77 failed on branch feature/x");
    expect(turn.prompt).toContain("boom — implementation error");
    expect(recordedInputs(j).some((r) => r.promptIsBody === true)).toBe(true);
    expect(reply).toContain("succeeded");
  });

  it("second turn after a run: the message is the guidance refine", async () => {
    const { def, j } = make(
      nodeRow({
        node_key: "pipeline",
        type: "pipeline",
        status: "done",
        output: { pipelineId: 77, status: "success", fixes: 0 },
        input: { branchName: null, pipelineId: null, guidance: null, prompt: null, promptIsBody: false, model: null },
        agent_id: "agent_prev",
      }),
    );
    await def.chat(ctx, "Speed up the flaky test");
    expect(recordedInputs(j).some((r) => r.guidance === "Speed up the flaky test")).toBe(true);
    expect(j.labels[0]).toContain("pipeline fix");
    const turn = j.startAgentInputs[0] as unknown as { prompt: string };
    expect(turn.prompt).toContain("Developer guidance: Speed up the flaky test");
  });

  it("a gate with no merge request answers instead of throwing", async () => {
    const j = newJournal();
    const def = new PipelineNode(
      stubSupport(j, nodeRow({ node_key: "pipeline", type: "pipeline" })),
      stubRunner(j, []),
      ctxHelper,
      { forRepo: () => ({}) } as unknown as GitHostResolver,
    );
    const reply = await def.chat({ ...ctx, flow: { ...ctx.flow, mr_iid: null } }, "run now");
    expect(reply).toContain("No merge request yet");
    expect(j.startAgentInputs).toHaveLength(0);
  });
});

// ── build ───────────────────────────────────────────────────────────────────

describe("BuildNode chat", () => {
  const planArtifact = { id: "art_plan_ft", version: 3, content: "# Approved plan\n\nlogins.", meta: "{}" };

  const make = (node: NodeRow) => {
    const j = newJournal();
    const support = stubSupport(j, node) as NodeSupport & {
      latestArtifact: (...args: unknown[]) => unknown;
    };
    support.latestArtifact = (...args: unknown[]) =>
      (args[2] as { nodeType?: string })?.nodeType === "plan" ? planArtifact : null;
    const def = new BuildNode(support as NodeSupport, stubRunner(j, ["built it"]), ctxHelper);
    return { def, j };
  };

  it("first turn on a never-run node: the message is the build body (the approved plan rides the input blob)", async () => {
    const { def, j } = make(nodeRow({ node_key: "build", type: "build" }));
    await def.chat(ctx, "Start with the API routes.");
    expect(j.labels).toEqual(["build"]);
    const turn = j.startAgentInputs[0] as unknown as { prompt: string };
    // the build template is body-only (plan + checklist render inside it), so
    // the chat body run replaces the body wholesale — exactly the config
    // prompt_body overshoot (promptIsBody semantics, no internal blocks)
    expect(turn.prompt).toBe("Start with the API routes.");
    const recorded = recordedInputs(j)[0];
    // the approved plan + body + model recorded for retry fidelity
    expect(recorded).toMatchObject({
      promptIsBody: true,
      plan: "# Approved plan\n\nlogins.",
      prompt: "Start with the API routes.",
    });
  });

  it("the standing rules knob still applies after the chat body", async () => {
    const j = newJournal();
    const support = stubSupport(j, nodeRow({
      node_key: "build",
      type: "build",
      config: { prompt_rules: "Run npm test before pushing." },
    })) as NodeSupport & { latestArtifact: (...args: unknown[]) => unknown };
    support.latestArtifact = (...args: unknown[]) =>
      (args[2] as { nodeType?: string })?.nodeType === "plan" ? planArtifact : null;
    const def = new BuildNode(
      support as NodeSupport,
      stubRunner(j, ["built it"]),
      ctxHelper,
    );
    await def.chat(ctx, "Start with the API routes.");
    const turn = j.startAgentInputs[0] as unknown as { prompt: string };
    expect(turn.prompt).toBe(
      "Start with the API routes.\n\nRun npm test before pushing.",
    );
  });

  it("a never-run build with no approved plan refuses with the trigger's error", async () => {
    const j = newJournal();
    const support = stubSupport(j, nodeRow({ node_key: "build", type: "build" }));
    const def = new BuildNode(support, stubRunner(j, []), ctxHelper);
    await expect(def.chat(ctx, "go")).rejects.toThrow("no plan to build — approve the plan first");
  });

  it("second turn after a run: the message is the feedback refine", async () => {
    const { def, j } = make(
      nodeRow({
        node_key: "build",
        type: "build",
        status: "awaiting_approval",
        output: { branch: ctx.flow.mr_branch ?? "", latestArtifact: "art_diff" },
        agent_id: "agent_prev",
      }),
    );
    await def.chat(ctx, "Please squash the commits");
    const recorded = recordedInputs(j)[0];
    expect(recorded).toMatchObject({ feedback: "Please squash the commits", prompt: null });
    expect(removeUndefined(recorded)).not.toHaveProperty("promptIsBody", true);
    const turn = j.startAgentInputs[0] as unknown as { prompt: string; followUpOn: string | null };
    expect(turn.followUpOn).toBe("agent_prev");
    expect(turn.prompt).toContain("Please squash the commits");
  });
});

/** Drop undefined values so `not.toHaveProperty(k, true)` means "not true" even
 *  when the record omits the key. */
function removeUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined));
}
