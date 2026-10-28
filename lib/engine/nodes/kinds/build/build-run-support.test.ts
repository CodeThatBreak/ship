/**
 * T6 (node-definition refactor, phase 6): the `StepBuildNode extends BuildNode`
 * lineage is broken. The step child is a SIBLING def on the AgentRunNode tier
 * and composes the shared run machinery over `BuildRunSupport` (branch
 * assignment, worktree lifecycle, result-branch detection, diff artifact);
 * both defs own their run() end-to-end.
 *
 * Covered here:
 *  - the lineage + the flags/config defaults the split must preserve (the
 *    step child keeps the ALL-sources MCP default it inherited from BuildNode);
 *  - the composed machinery's branch assignment and artifact persistence;
 *  - the step child's fan-out restart recovery (applyOutcome — the ONE
 *    persistence path) and its chat-refine terminal through the runner seam.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Must run before any `../../../db` import touches the connection — dynamic
// imports below execute in statement order after the static ones hoist.
process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-build-run-support-")),
  "test.db",
);

const { db } = await import("../../../../db");
const { nodeSupport } = await import("../../shared/node-support");
const { flowCtxHelper, FlowContextHelper } = await import("../../shared/run-context");
const { usageTracker } = await import("../../../harness/usage-tracker");
const { AgentRunner } = await import("../../../harness/agent-runner");
const { AgentRunNode } = await import("../../shared");
const { BuildRunSupport } = await import("./build-run-support");
// the registry singleton first — entering the prompts → registry → build
// cluster from the build defs' side leaves the registry mid-eval when its
// registerBuiltins() runs (the cycle pre-exists; flow.ts-based entry avoids it)
const { nodeRegistry } = await import("../../registry");
const { StepBuildNode } = await import("./step-build-node");
const { BuildNode } = await import("./build-node");
import type { AgentRunResult } from "../../../ports/agent-port";
import type { DiffFile } from "../../../../git/local";
import type { FlowCtx } from "../../shared";
import type { NodeRow } from "../../../../db/rows";

const now = () => new Date().toISOString();

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
function must<T>(row: T | undefined, what: string): T {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
}

/** One isolated task + flow (+ optional fan-out linkage) + a node row. */
function seed(index: number, opts: { nodeKey?: string; type?: string; mrBranch?: string | null; status?: string } = {}): { flowId: string; nodeId: string; ctx: FlowCtx } {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  const nodeId = `node_${index}`;
  const nodeKey = opts.nodeKey ?? "build";
  const type = opts.type ?? nodeKey;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId, "generic", `TST-${index}`, "build run support test", "open", "story", "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, mr_branch, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    flowId, taskId, `build run support test ${index}`, "active", "cloud", opts.mrBranch ?? null, now(), now(),
  );
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    nodeId, flowId, nodeKey, type, opts.status ?? "pending", now(), now(),
  );
  const ctx = {
    flow: { id: flowId, task_id: taskId, name: `test ${index}`, status: "active", execution_mode: "cloud", mr_branch: opts.mrBranch ?? null, parent_flow_id: null, created_at: now(), updated_at: now() },
    task: { id: taskId, type: "generic", key: `TST-${index}`, summary: "test", fields: {}, status: "open", issueType: "story", priority: "P2" },
  } as unknown as FlowCtx;
  return { flowId, nodeId, ctx };
}

/** A makeDiff stand-in — the helper takes the ctxHelper through its seam. */
class DiffStub extends FlowContextHelper {
  constructor(private readonly diff: { files: DiffFile[]; stat: string; raw: string } | null) {
    super();
  }
  override makeDiff(): Promise<{ files: DiffFile[]; stat: string; raw: string } | null> {
    return Promise.resolve(this.diff);
  }
}

/** executeRun stand-in with the real runner's persistence contract. */
class StubRunner extends AgentRunner {
  constructor(private readonly result: AgentRunResult) {
    super(flowCtxHelper, nodeSupport, usageTracker);
  }
  override async executeRun(
    ctx: FlowCtx,
    nodeId: string,
    _start: () => Promise<never>,
    label: string,
  ): Promise<AgentRunResult> {
    this.support.persistRun(ctx.flow.id, nodeId, "agt_test", "run_test");
    db.emitEvent(ctx.flow.id, nodeId, "lifecycle", `${label} started (cloud)`);
    db.emitEvent(ctx.flow.id, nodeId, "lifecycle", `${label} finished`);
    return this.result;
  }
}

describe("build defs lineage + defaults (T6)", () => {
  it("the step child is a sibling def on the AgentRunNode tier, not a BuildNode subclass", () => {
    const step = new StepBuildNode();
    expect(step).not.toBeInstanceOf(BuildNode);
    expect(step).toBeInstanceOf(AgentRunNode);
    expect(step.key).toBe("step_build");
    // the step child holds no chain role and does not own the build approval —
    // its approval is the generic one that triggers mergeBack
    expect(step.chainRole).toBeNull();
    expect(step.builtinApproval).toBe(false);
    expect(step.childTemplateId()).toBeNull();
    // the registry resolves the sibling by its own key (the catalog stays flat)
    expect(nodeRegistry.get(step.key)).toBeDefined();
  });

  it("the step child keeps the ALL-sources MCP default it inherited from the parent build", () => {
    expect(new BuildNode().defaultConfig().mcp_sources).toEqual(["all"]);
    expect(new StepBuildNode().defaultConfig().mcp_sources).toEqual(["all"]);
  });
});

describe("BuildRunSupport — branch assignment", () => {
  it("flowBranch prefers the assigned flow branch; else the built-in naming (with the optional suffix)", () => {
    const run = new BuildRunSupport();
    const assigned = must(seed(11, { mrBranch: "feature/x-step" }), "seed 11");
    expect(run.flowBranch(assigned.ctx)).toBe("feature/x-step");
    const unassigned = must(seed(12), "seed 12");
    expect(run.flowBranch(unassigned.ctx)).toBe("feature/tst-12-flw_12");
    expect(run.flowBranch(unassigned.ctx, "s2")).toBe("feature/tst-12-flw_12-s2");
  });

  it("branchName resolves the branch_pattern knob's tokens; empty pattern = built-in naming", () => {
    const run = new BuildRunSupport();
    const s = must(seed(13), "seed 13");
    expect(run.branchName(s.ctx, { branch_pattern: "{prefix}/{ticket}-x-{id}-{suffix}" }, "s2"))
      .toBe("feature/TST-13-x-flw_13-s2");
    expect(run.branchName(s.ctx, {}, "s2")).toBe("feature/tst-13-flw_13-s2");
  });
});

describe("BuildRunSupport — run-finish facts (cloud ctx)", () => {
  it("resultBranch takes the agent's reported branch; refineBranch lets the flow's branch win", async () => {
    const run = new BuildRunSupport();
    const s = must(seed(21, { mrBranch: "bugfix/flow-branch" }), "seed 21");
    const result = {
      status: "finished",
      result: "done",
      git: { branches: [{ branch: "bugfix/pushed-branch" }] },
    } as unknown as AgentRunResult;
    expect(await run.resultBranch(s.ctx, result, "feature/tst-21-flw_21")).toBe("bugfix/pushed-branch");
    expect(await run.refineBranch(s.ctx, result)).toBe("bugfix/flow-branch");
    const bare = { status: "finished", result: "done" } as unknown as AgentRunResult;
    expect(await run.resultBranch(s.ctx, bare, "feature/tst-21-flw_21")).toBe("feature/tst-21-flw_21");
  });
});

describe("BuildRunSupport — the per-branch diff artifact", () => {
  it("saves the raw diff as content with branch/stat (+ extras) as meta", async () => {
    const s = must(seed(31), "seed 31");
    const run = new BuildRunSupport(nodeSupport, new DiffStub({ files: [], stat: "3 files changed", raw: "diff --git a/x b/x" }));
    const art = await run.diffArtifact(s.ctx, s.nodeId, "bugfix/tst-31-flw_31", { extraMeta: { feedback: "fix it" } });
    const row = must(
      db.get<{ kind: string; content: string; meta: string | null; status: string }>(
        `SELECT kind, content, meta, status FROM artifacts WHERE id=?`, art.id,
      ),
      `artifact ${art.id}`,
    );
    expect(row.kind).toBe("diff");
    expect(row.content).toBe("diff --git a/x b/x");
    expect(JSON.parse(row.meta ?? "{}")).toEqual({ branch: "bugfix/tst-31-flw_31", stat: "3 files changed", feedback: "fix it" });
  });

  it("a no-diff finish stores the caller's placeholder instead", async () => {
    const s = must(seed(32), "seed 32");
    const run = new BuildRunSupport(nodeSupport, new DiffStub(null));
    const art = await run.diffArtifact(s.ctx, s.nodeId, "bugfix/tst-32-flw_32", { noDiffContent: "(diff unavailable)" });
    const row = must(
      db.get<{ content: string; meta: string | null }>(
        `SELECT content, meta FROM artifacts WHERE id=?`, art.id,
      ),
      `artifact ${art.id}`,
    );
    expect(row.content).toBe("(diff unavailable)");
    expect(JSON.parse(row.meta ?? "{}")).toEqual({ branch: "bugfix/tst-32-flw_32", stat: "" });
  });
});

describe("StepBuildNode — fan-out child paths (T6)", () => {
  it("recover persists the awaiting_approval step state through applyOutcome — the ONE persistence path", async () => {
    const s = must(seed(41, { nodeKey: "step_build", type: "step_build", mrBranch: "bugfix/step-2", status: "running" }), "seed 41");
    // the run row the dead process left behind
    nodeSupport.persistRun(s.flowId, s.nodeId, "agt_orphan", "run_orphan");
    const nodeRow = must(db.get<NodeRow>(`SELECT * FROM nodes WHERE id=?`, s.nodeId), `node ${s.nodeId}`);
    const step = new StepBuildNode();

    expect(await step.recover(s.ctx, nodeRow, { status: "finished", result: "step done" } as unknown as AgentRunResult, "server restarted")).toBe(true);

    const node = must(
      db.get<{ status: string; agent_id: string | null; output: string | null }>(
        `SELECT status, agent_id, output FROM nodes WHERE id=?`, s.nodeId,
      ),
      `node ${s.nodeId}`,
    );
    expect(node.status).toBe("awaiting_approval");
    expect(node.agent_id).toBe("agt_orphan");
    const output = JSON.parse(node.output ?? "{}") as { branch: string; latestArtifact: string };
    expect(output.branch).toBe("bugfix/step-2");
    const art = must(
      db.get<{ kind: string; content: string; meta: string | null }>(
        `SELECT kind, content, meta FROM artifacts WHERE id=?`, output.latestArtifact,
      ),
      `artifact ${output.latestArtifact}`,
    );
    expect(art.kind).toBe("diff");
    expect(art.content).toBe("(diff unavailable — fetch from GitLab)");
    expect(JSON.parse(art.meta ?? "{}")).toEqual({ branch: "bugfix/step-2", stat: "", recovered: true });
    const events = db.all<{ type: string; message: string; data: string | null }>(
      `SELECT type, message, data FROM events WHERE node_id=? AND message LIKE '%recovered%'`, s.nodeId,
    );
    expect(events.at(-1)?.type).toBe("lifecycle");
    expect(events.at(-1)?.message).toBe("step build recovered on branch bugfix/step-2; diff ready for review (server restarted)");
    expect(JSON.parse(events.at(-1)?.data ?? "{}")).toEqual({ recovered: true });

    // idempotent: a concurrent reconcile finding a non-running node declines silently
    const recovered = must(db.get<NodeRow>(`SELECT * FROM nodes WHERE id=?`, s.nodeId), `node ${s.nodeId}`);
    expect(await step.recover(s.ctx, recovered, { status: "finished", result: "again" } as unknown as AgentRunResult, "again")).toBe(true);
    expect(db.get<{ id: string; version: number }>(
      `SELECT id, version FROM artifacts WHERE node_id=? AND kind='diff' ORDER BY version DESC LIMIT 1`, s.nodeId,
    )?.version).toBe(1); // no second artifact
  });

  it("a non-finished run declines recovery", async () => {
    const s = must(seed(42, { nodeKey: "step_build", type: "step_build", status: "running" }), "seed 42");
    const nodeRow = must(db.get<NodeRow>(`SELECT * FROM nodes WHERE id=?`, s.nodeId), `node ${s.nodeId}`);
    const step = new StepBuildNode();
    expect(await step.recover(s.ctx, nodeRow, { status: "error" } as unknown as AgentRunResult, "server restarted")).toBe(false);
    expect(db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=?`, s.nodeId)?.status).toBe("running");
  });

  it("the chat-refine terminal reruns on the step branch and saves the per-step diff", async () => {
    const s = must(seed(43, { nodeKey: "step_build", type: "step_build", mrBranch: "bugfix/step-3", status: "awaiting_approval" }), "seed 43");
    const step = new StepBuildNode(nodeSupport, new StubRunner({ status: "finished", result: "step fixed" } as unknown as AgentRunResult));
    const outcome = await step.run(
      s.ctx,
      { plan: null, prompt: null, branchInfo: null, feedback: "fix the flaky test", model: null },
      {},
    );
    expect(outcome.status).toBe("awaiting_approval");
    expect(outcome.reply).toBe("step fixed");
    const output = JSON.parse(must(
      db.get<{ output: string | null }>(`SELECT output FROM nodes WHERE id=?`, s.nodeId),
      `node output ${s.nodeId}`,
    ).output ?? "{}") as { branch: string; latestArtifact: string };
    expect(output.branch).toBe("bugfix/step-3");
    const art = must(
      db.get<{ kind: string; content: string; meta: string | null }>(
        `SELECT kind, content, meta FROM artifacts WHERE id=?`, output.latestArtifact,
      ),
      `artifact ${output.latestArtifact}`,
    );
    expect(art.content).toBe("step fixed"); // no diff — the agent's reply stands in
    expect(JSON.parse(art.meta ?? "{}")).toEqual({ branch: "bugfix/step-3", stat: "", feedback: "fix the flaky test" });
    const events = db.all<{ message: string }>(
      `SELECT message FROM events WHERE node_id=? AND message LIKE '%step updated%'`, s.nodeId,
    );
    expect(events.at(-1)?.message).toBe("step updated per feedback; new per-step diff ready");
  });
});
