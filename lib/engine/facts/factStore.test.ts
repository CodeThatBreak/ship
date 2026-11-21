import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";
import { testAll, testGet, testRun } from "../../../tests/helpers/rawTestDb";
import type { Started, AgentStartInput, ExecuteRunResult } from "../harness/types/agentRunTypes";
import type { AgentRunResult } from "../ports/agentPort";
import type { FlowCtx } from "../nodes/shared/nodeSharedExports";

// Must run before any `../../db` import touches the connection — dynamic
// imports below resolve lazily once DATABASE_URL points at the test database.
assignTestDatabase();

const { db } = await import("../../db/app");
beforeAll(resetTestDatabase);
const { FactStore } = await import("./factStore");
const { branchStore } = await import("../nodes/kinds/build/branchStore");
const { nodeSupport } = await import("@/lib/composition/container");
const { AgentDefSchema } = await import("../nodes/schemas/declarativeSchemas");
const { AGENT_CONFIG_FIELDS } = await import("../nodes/kinds/agent/constants/agentConstantsExports");
const { FACT_KIND } = await import("./types/facts");
const { AgentRunner } = await import("../harness/agentRunner/agentRunner");
const { AgentTemplateNode } = await import("../nodes/kinds/agent/agentTemplateNode");
const { FlowContextHelper } = await import("../nodes/shared/runContext/flowContextHelper");
const { flowCtxHelper } = await import("../nodes/shared/runContext");
const { usageTracker } = await import("../harness/usageTracker");
const { config } = await import("../../config");
const { agentPortRegistry } = await import("../ports/agentPort");
const { worktreeManager } = await import("../runtime/worktreeLifecycle");

const facts = new FactStore(nodeSupport, branchStore);

const now = () => new Date().toISOString();

/** A task + flow (+ one node row for artifact writes); returns the node row id. */
const seedFlow = async (flowId: string): Promise<string> => {
  const taskId = `task_${flowId}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId,
    "generic",
    `BR-${flowId}`,
    "fact store test",
    "open",
    "story",
    "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    flowId,
    taskId,
    "fact store test",
    "active",
    now(),
    now(),
  );
  const nodeId = db.uid("node_");
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId,
    flowId,
    "agent_1",
    "agent",
    "running",
    now(),
    now(),
  );
  return nodeId;
};

/** A branch row seeded straight through SQL, with explicit timestamps. */
const seedBranch = async (
  flowId: string,
  name: string,
  opts: { mrIid?: number; updatedAt: string },
): Promise<void> => {
  await testRun(
    `INSERT INTO branches (id, flow_id, name, title, status, mr_iid, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    db.uid("br_"),
    flowId,
    name,
    name,
    "approved",
    opts.mrIid ?? null,
    now(),
    opts.updatedAt,
  );
};

describe("FactStore.recordBranch (Task 06)", () => {
  it("persists a branch row with the fact status and the git branch", async () => {
    const flowId = "flw_fact_branch";
    await seedFlow(flowId);

    const rowId = await facts.recordBranch(flowId, { name: "feat/a", gitBranch: "bugfix/feat-a" });

    const row = await testGet<{ id: string; status: string; git_branch: string | null }>(
      `SELECT id, status::text AS status, git_branch FROM branches WHERE flow_id=$1 AND name=$2`,
      flowId,
      "feat/a",
    );
    expect(row?.id).toBe(rowId);
    // `building` — the BRANCH_FACT_STATUS deviation note in constants/branchFactStatus.ts
    expect(row?.status).toBe("building");
    expect(row?.git_branch).toBe("bugfix/feat-a");
  });

  it("updates the existing row on a re-record (no duplicate)", async () => {
    const flowId = "flw_fact_branch2";
    await seedFlow(flowId);
    const first = await facts.recordBranch(flowId, { name: "feat/b", gitBranch: "bugfix/feat-b" });

    const second = await facts.recordBranch(flowId, { name: "feat/b", gitBranch: "bugfix/feat-b-2" });

    expect(second).toBe(first);
    const rows = await testGet<{ count: bigint }>(
      `SELECT count(*) AS count FROM branches WHERE flow_id=$1 AND name=$2`,
      flowId,
      "feat/b",
    );
    expect(rows?.count).toBe(1n);
    const updated = await testGet<{ git_branch: string | null }>(
      `SELECT git_branch FROM branches WHERE id=$1`,
      first,
    );
    expect(updated?.git_branch).toBe("bugfix/feat-b-2");
  });
});

describe("FactStore.recordDiff (Task 06)", () => {
  it("persists a diff artifact with the meta {branch, stat} shape stepRollup writes", async () => {
    const flowId = "flw_fact_diff";
    const nodeId = await seedFlow(flowId);

    const art = await facts.recordDiff(flowId, nodeId, {
      branch: "feat/a",
      raw: "diff --git a/x b/x",
      stat: "1 file changed",
    });

    const row = await testGet<{ id: string; version: number; content: string; branch: string | null; stat: string | null }>(
      `SELECT id, version, content, meta->>'branch' AS branch, meta->>'stat' AS stat
       FROM artifacts WHERE id=$1`,
      art.id,
    );
    expect(row?.content).toBe("diff --git a/x b/x");
    expect(row?.branch).toBe("feat/a");
    expect(row?.stat).toBe("1 file changed");
  });

  it("a second record supersedes the first version (the artifact-version discipline)", async () => {
    const flowId = "flw_fact_diff2";
    const nodeId = await seedFlow(flowId);
    const v1 = await facts.recordDiff(flowId, nodeId, { branch: "feat/a", raw: "raw-1", stat: "s1" });
    const v2 = await facts.recordDiff(flowId, nodeId, { branch: "feat/a", raw: "raw-2", stat: "s2" });

    expect(v2.version).toBe(v1.version + 1);
    const superseded = await testGet<{ status: string }>(
      `SELECT status::text AS status FROM artifacts WHERE id=$1`,
      v1.id,
    );
    expect(superseded?.status).toBe("superseded");
    const draft = await testGet<{ status: string; content: string }>(
      `SELECT status::text AS status, content FROM artifacts WHERE id=$1`,
      v2.id,
    );
    expect(draft?.status).toBe("draft");
    expect(draft?.content).toBe("raw-2");
  });
});

describe("FactStore.recordChangeRequest (Task 06)", () => {
  it("persists mrIid/mrUrl onto the named branch row", async () => {
    const flowId = "flw_fact_cr_branch";
    await seedFlow(flowId);
    await facts.recordBranch(flowId, { name: "feat/a", gitBranch: "bugfix/feat-a" });

    await facts.recordChangeRequest(flowId, { mrIid: 42, mrUrl: "https://git/mr/42", branchName: "feat/a" });

    const row = await testGet<{ mr_iid: number | null; mr_url: string | null }>(
      `SELECT mr_iid, mr_url FROM branches WHERE flow_id=$1 AND name=$2`,
      flowId,
      "feat/a",
    );
    expect(row?.mr_iid).toBe(42);
    expect(row?.mr_url).toBe("https://git/mr/42");
  });

  it("persists onto the flow-level MR columns when no branch is named", async () => {
    const flowId = "flw_fact_cr_flow";
    await seedFlow(flowId);

    await facts.recordChangeRequest(flowId, { mrIid: 7, mrUrl: "https://git/mr/7", branchName: null });

    const row = await testGet<{ mr_iid: number | null; mr_url: string | null }>(
      `SELECT mr_iid, mr_url FROM flows WHERE id=$1`,
      flowId,
    );
    expect(row?.mr_iid).toBe(7);
    expect(row?.mr_url).toBe("https://git/mr/7");
  });

  it("a null mrUrl never clobbers an existing flow MR url", async () => {
    const flowId = "flw_fact_cr_nullurl";
    await seedFlow(flowId);
    await facts.recordChangeRequest(flowId, { mrIid: 7, mrUrl: "https://git/mr/7", branchName: null });

    await facts.recordChangeRequest(flowId, { mrIid: 8, mrUrl: null, branchName: null });

    const row = await testGet<{ mr_iid: number | null; mr_url: string | null }>(
      `SELECT mr_iid, mr_url FROM flows WHERE id=$1`,
      flowId,
    );
    expect(row?.mr_iid).toBe(8);
    expect(row?.mr_url).toBe("https://git/mr/7");
  });
});

describe("FactStore lookups (Task 06 — resolvers and the flow context)", () => {
  it("changeRequestFact resolves the named branch's MR", async () => {
    const flowId = "flw_fact_lookup_branch";
    await seedFlow(flowId);
    await facts.recordBranch(flowId, { name: "feat/a" });
    await facts.recordChangeRequest(flowId, { mrIid: 42, mrUrl: "https://git/mr/42", branchName: "feat/a" });

    const fact = await facts.changeRequestFact(flowId, "feat/a");

    expect(fact).toEqual({ mrIid: 42, mrUrl: "https://git/mr/42", branchName: "feat/a" });
  });

  it("without a branch name: flow MR first, then the most recent branch MR", async () => {
    const flowId = "flw_fact_lookup_flow";
    await seedFlow(flowId);
    await seedBranch(flowId, "old", { mrIid: 10, updatedAt: "2026-01-01T00:00:00Z" });
    await seedBranch(flowId, "new", { mrIid: 11, updatedAt: "2026-02-01T00:00:00Z" });

    // no flow MR → the most recent branch row carrying an MR wins
    expect(await facts.changeRequestFact(flowId)).toEqual({
      mrIid: 11,
      mrUrl: null,
      branchName: "new",
    });

    await facts.recordChangeRequest(flowId, { mrIid: 99, mrUrl: "https://git/mr/99", branchName: null });
    const flowMr = await facts.changeRequestFact(flowId);
    expect(flowMr).toEqual({ mrIid: 99, mrUrl: "https://git/mr/99", branchName: null });
  });

  it("returns null when nothing established a change_request", async () => {
    const flowId = "flw_fact_lookup_none";
    await seedFlow(flowId);
    expect(await facts.changeRequestFact(flowId)).toBeNull();
    expect(await facts.changeRequestFact(flowId, "nope")).toBeNull();
  });

  it("branchFacts/branchFact/diffFacts read back what the writes persisted", async () => {
    const flowId = "flw_fact_lookup_all";
    const nodeId = await seedFlow(flowId);
    await facts.recordBranch(flowId, { name: "feat/a", gitBranch: "bugfix/feat-a" });
    await facts.recordDiff(flowId, nodeId, { branch: "feat/a", raw: "raw", stat: "stat" });

    const branches = await facts.branchFacts(flowId);
    expect(branches).toHaveLength(1);
    expect(branches[0]?.name).toBe("feat/a");
    expect(await facts.branchFact(flowId, "feat/a")).not.toBeNull();
    expect(await facts.branchFact(flowId, "nope")).toBeNull();

    const diffs = await facts.diffFacts(flowId);
    expect(diffs).toHaveLength(1);
    // Task 08: the meta carries the attribution vocabulary — a capture with
    // no pinned base reads as the whole-branch projection
    expect(diffs[0]?.meta).toEqual({ branch: "feat/a", stat: "stat", attribution: "all" });
  });
});

describe("FactStore batch discipline (Task 06 — Invariant F2)", () => {
  it("all fact writes land inside ONE caller transaction; a throw rolls the batch back", async () => {
    const flowId = "flw_fact_batch";
    const nodeId = await seedFlow(flowId);

    await nodeSupport.transaction(async (tx) => {
      await facts.recordBranch(flowId, { name: "feat/a", gitBranch: "bugfix/feat-a" }, tx);
      await facts.recordDiff(flowId, nodeId, { branch: "feat/a", raw: "raw", stat: "stat" }, tx);
      await facts.recordChangeRequest(flowId, { mrIid: 42, mrUrl: null, branchName: "feat/a" }, tx);
    });

    const branchRow = await testGet<{ mr_iid: number | null }>(
      `SELECT mr_iid FROM branches WHERE flow_id=$1 AND name=$2`,
      flowId,
      "feat/a",
    );
    expect(branchRow?.mr_iid).toBe(42);
    expect(await testGet<{ count: bigint }>(
      `SELECT count(*) AS count FROM artifacts WHERE flow_id=$1 AND kind='diff'`,
      flowId,
    )).toMatchObject({ count: 1n });

    await expect(
      nodeSupport.transaction(async (tx) => {
        await facts.recordBranch(flowId, { name: "feat/lost", gitBranch: null }, tx);
        await facts.recordDiff(flowId, nodeId, { branch: "feat/lost", raw: "raw", stat: "stat" }, tx);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await facts.branchFact(flowId, "feat/lost")).toBeNull();
    expect(await testGet<{ count: bigint }>(
      `SELECT count(*) AS count FROM artifacts WHERE flow_id=$1 AND kind='diff'`,
      flowId,
    )).toMatchObject({ count: 1n });
  });
});

describe("AgentDefSchema.produces (Task 06 — the F4 pin Task 07 extends)", () => {
  it("defaults to [] — an undeclaring agent establishes no facts", () => {
    expect(AgentDefSchema.parse({}).produces).toEqual([]);
  });

  it("accepts branch/diff and rejects change_request (not producible by a run)", () => {
    expect(AgentDefSchema.parse({ produces: ["branch", "diff"] }).produces).toEqual(["branch", "diff"]);
    expect(() => AgentDefSchema.parse({ produces: [FACT_KIND.CHANGE_REQUEST] })).toThrow();
    expect(() => AgentDefSchema.parse({ produces: ["bogus"] })).toThrow();
  });

  it("the authoring form exposes produces as a multi field over the fact vocabulary", () => {
    const field = AGENT_CONFIG_FIELDS.find((f) => f.key === "produces");
    expect(field?.type).toBe("multi");
    expect(field?.options?.map((o) => o.value)).toEqual(["branch", "diff"]);
  });
});

// Task 06 pins the vocabulary above; the block below is Task 07's F4
// consumption test: an agent def WITHOUT `produces` persists no branch/diff
// rows even when `result.git.branches` is set (the finalizeOutput wiring).

/** executeRun stand-in (the agentTemplateNode.test.ts pattern): the stubbed
 *  result back to the def, the start recorded. */
class FactTestRunner extends AgentRunner {
  private readonly queue: AgentRunResult[];
  readonly starts: AgentStartInput[] = [];

  constructor(...results: AgentRunResult[]) {
    super(flowCtxHelper, nodeSupport, usageTracker, db, config, agentPortRegistry, worktreeManager);
    this.queue = [...results];
  }

  override async startAgent(_ctx: FlowCtx, input: AgentStartInput): Promise<Started> {
    this.starts.push(input);
    return { agentId: "agt_facts", runId: `run_facts_${this.starts.length}` };
  }

  override async executeRun(
    ctx: FlowCtx,
    nodeId: string,
    start: () => Promise<Started>,
    label: string,
  ): Promise<ExecuteRunResult> {
    const result = this.queue.shift();
    if (result == null) throw new Error(`${label}: no stubbed run result left`);
    const { agentId, runId } = await start();
    await this.support.persistRun(ctx.flow.id, nodeId, agentId, runId);
    if (result.status !== "finished") throw new Error(`${label} ended with status ${result.status}`);
    return { result, runRowId: `runrow_${runId}` };
  }
}

/** makeDiff stand-in: records every capture and returns a fixed payload —
 *  the real one is git I/O and the test flow has no repo. Task 08: the
 *  capture records the pinned baseSha and returns the attributed shape. */
class FactTestCtxHelper extends FlowContextHelper {
  readonly captured: string[] = [];
  readonly baseShaCalls: (string | null | undefined)[] = [];
  readonly capturedBaseSha: (string | null)[] = [];
  override async baseShaOf(_ctx: FlowCtx, ref: string | null | undefined): Promise<string | null> {
    this.baseShaCalls.push(ref);
    // the resolved base_ref would rev-parse here; the stub pins a fixed SHA
    return ref ? "sha_base_1" : null;
  }
  override async makeDiff(
    _ctx: FlowCtx,
    branch: string,
    opts: { baseSha?: string | null } = {},
  ): Promise<{ files: never[]; stat: string; raw: string; baseSha?: string | null; headSha?: string | null; attribution?: "agent" | "all"; alt?: { attribution: "agent" | "all"; stat: string; raw: string } } | null> {
    this.captured.push(branch);
    this.capturedBaseSha.push(opts.baseSha ?? null);
    const pinned = Boolean(opts.baseSha);
    return {
      files: [],
      stat: "1 file changed",
      raw: "diff --git a/x b/x",
      ...(pinned ? { baseSha: opts.baseSha, headSha: "sha_head_9", attribution: "agent" as const, alt: { attribution: "all" as const, stat: "1 file changed", raw: "diff --git a/y b/y" } } : {}),
    };
  }
}

/** A minimal FlowCtx over a seeded flow (the run path reads flow/task fields only). */
const factCtx = (flowId: string): FlowCtx =>
  ({
    flow: { id: flowId, taskId: `task_${flowId}`, name: "fact store test", status: "active", executionMode: "cloud", createdAt: now(), updatedAt: now() },
    task: { id: `task_${flowId}`, type: "generic", key: `BR-${flowId}`, summary: "fact store test", fields: {}, status: "open", issueType: "story", priority: "P2" },
  }) as unknown as FlowCtx;

describe("Agent run result.git → facts (Task 07 — the F4 consumption)", () => {
  it("an agent run reporting git.branches with produces [branch,diff] persists one branch row + one diff artifact", async () => {
    const flowId = "flw_fact_f4_produces";
    await seedFlow(flowId);
    const ctxHelper = new FactTestCtxHelper();
    const node = new AgentTemplateNode(
      { id: "nt_f4", name: "Fact Agent", description: null, config: {} },
      "agent_1",
      {
        runner: new FactTestRunner({
          status: "finished",
          result: "# Done",
          git: { branches: [{ branch: "changelog/x" }] },
        }),
        ctxHelper,
      },
    );

    await node.run(factCtx(flowId), { prompt: "Do the work" }, { produces: ["branch", "diff"] });

    // the branch fact → exactly one branch row, the fact status, the git branch
    const row = await testGet<{ status: string; git_branch: string | null }>(
      `SELECT status::text AS status, git_branch FROM branches WHERE flow_id=$1 AND name=$2`,
      flowId,
      "changelog/x",
    );
    expect(row?.status).toBe("building");
    expect(row?.git_branch).toBe("changelog/x");
    expect(await testGet<{ count: bigint }>(`SELECT count(*) AS count FROM branches WHERE flow_id=$1`, flowId))
      .toMatchObject({ count: 1n });

    // the diff fact → exactly one kind:"diff" artifact, meta {branch, stat}
    const diffs = await testAll<{ content: string; branch: string | null; stat: string | null }>(
      `SELECT content, meta->>'branch' AS branch, meta->>'stat' AS stat FROM artifacts WHERE flow_id=$1 AND kind='diff'`,
      flowId,
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.content).toBe("diff --git a/x b/x");
    expect(diffs[0]?.branch).toBe("changelog/x");
    expect(diffs[0]?.stat).toBe("1 file changed");
    // the capture ran exactly once, for the reported branch
    expect(ctxHelper.captured).toEqual(["changelog/x"]);
  });

  it("an agent run WITHOUT produces persists neither (F4 — undeclared git facts stay dropped)", async () => {
    const flowId = "flw_fact_f4_undeclared";
    await seedFlow(flowId);
    const ctxHelper = new FactTestCtxHelper();
    const node = new AgentTemplateNode(
      { id: "nt_f4b", name: "Fact Agent", description: null, config: {} },
      "agent_1",
      {
        runner: new FactTestRunner({
          status: "finished",
          result: "# Done",
          git: { branches: [{ branch: "changelog/x" }] },
        }),
        ctxHelper,
      },
    );

    await node.run(factCtx(flowId), { prompt: "Do the work" }, {});

    expect(await testGet<{ count: bigint }>(`SELECT count(*) AS count FROM branches WHERE flow_id=$1`, flowId))
      .toMatchObject({ count: 0n });
    expect(await testGet<{ count: bigint }>(
      `SELECT count(*) AS count FROM artifacts WHERE flow_id=$1 AND kind='diff'`,
      flowId,
    )).toMatchObject({ count: 0n });
    // undeclared ⇒ no git I/O either — the capture never runs, and the
    // Task 08 base pin is never resolved
    expect(ctxHelper.captured).toEqual([]);
    expect(ctxHelper.baseShaCalls).toEqual([]);
  });
});

// Task 08: the diff fact's attribution — the run-start base_ref pinned to a
// SHA, the capture's head anchor, and the agent-vs-branch projection the
// meta carries for the panel's toggle.
describe("Diff attribution meta (Task 08)", () => {
  it("run start resolves baseSha and the diff fact's meta carries the agent projection + the whole-branch alt", async () => {
    const flowId = "flw_fact_diffattr";
    await seedFlow(flowId);
    const ctxHelper = new FactTestCtxHelper();
    const node = new AgentTemplateNode(
      { id: "nt_diffattr", name: "Fact Agent", description: null, config: {} },
      "agent_1",
      {
        runner: new FactTestRunner({
          status: "finished",
          result: "# Done",
          git: { branches: [{ branch: "changelog/x" }] },
        }),
        ctxHelper,
      },
    );

    // the resolved starting ref (flow.mrBranch) is what run start pins
    const ctx = factCtx(flowId);
    (ctx.flow as Record<string, unknown>).mrBranch = "develop";
    await node.run(ctx, { prompt: "Do the work" }, { produces: ["branch", "diff"] });

    // run start resolved the base ref exactly once (git I/O at run start)
    expect(ctxHelper.baseShaCalls).toEqual(["develop"]);
    // the capture was handed the pinned SHA
    expect(ctxHelper.capturedBaseSha).toEqual(["sha_base_1"]);

    const row = await testGet<{ meta: Record<string, unknown> }>(
      `SELECT meta FROM artifacts WHERE flow_id=$1 AND kind='diff' AND status='draft'`,
      flowId,
    );
    expect(row?.meta).toEqual({
      branch: "changelog/x",
      stat: "1 file changed",
      attribution: "agent",
      baseSha: "sha_base_1",
      headSha: "sha_head_9",
      alt: { attribution: "all", stat: "1 file changed", raw: "diff --git a/y b/y" },
    });
  });
});
