/**
 * The pipeline gate's terminal output always satisfies its declared schema —
 * and a restart mid-wait resumes the gate from durable progress (engine
 * overhaul step 05; the step-00 red markers are flipped).
 *
 * The deadline-timeout terminal publishes a FULLY-POPULATED `PipelineOutput`
 * (the old `output ?? {}` — a bare `{}` violating the schema when no head
 * pipeline was ever seen — is gone).
 *
 * Restart mid-wait: the gate's `fixes`/`manualPlays`/`lastSeen`/deadline
 * persist as Zod-validated `gate_progress` artifact meta, and `recover()`
 * re-enters the wait from that snapshot — the budget is NOT re-spent.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { testAll, testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { registerFakeGitHost } from "../helpers/fakeGitHost";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { nodeRegistry } = await import("@/lib/engine/nodes/registry");

const gitHost = registerFakeGitHost();
const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

const GATE_INPUT = { branchName: null, pipelineId: null, guidance: null, model: null, prompt: null, promptIsBody: false };

/** Put the gate node in `running` (a mid-wait crash leaves it there). */
const claimGate = async (flowId: string): Promise<import("@/lib/db/rows").NodeRow> => {
  await testRun(
    `UPDATE nodes SET status='running', attempt_id='att_gate_resume' WHERE flow_id=$1 AND node_key='pipeline'`,
    flowId,
  );
  const node = await testGet<import("@/lib/db/rows").NodeRow>(
    `SELECT * FROM nodes WHERE flow_id=$1 AND node_key='pipeline'`,
    flowId,
  );
  if (!node) throw new Error("no pipeline node row");
  return node;
};

describe("pipeline gate terminal output is schema-valid", () => {
  test("deadline timeout with no head pipeline publishes a schema-valid PipelineOutput", async () => {
    const flowId = await harness.seedSdlcFlow();
    await testRun(`UPDATE flows SET mr_iid=$1, mr_branch=$2 WHERE id=$3`, 1, "devflow/ovh-gate", flowId);
    await claimGate(flowId);

    const graph = await harness.graphForFlow(flowId);
    const spec = graph?.byKey.get("pipeline");
    if (!spec) throw new Error("expected a pipeline node");
    const def = await nodeRegistry.resolve(spec.defKey, "pipeline");
    const ctx = await flowEngine.ctx(flowId);

    // drive the gate's run directly with a zero-length deadline: it times out
    // immediately having never seen a head pipeline — and the terminal output
    // satisfies PipelineOutput (pipelineId null + status "unknown", not {})
    const { PipelineOutput } = await import("@/lib/engine/nodes/kinds/pipeline/schema");
    const outcome = await def.run(
      ctx,
      GATE_INPUT,
      { gate_timeout_min: 0, poll_interval_sec: 0, max_fix_attempts: 0 },
    );
    expect(() => PipelineOutput.parse(outcome.output)).not.toThrow();
    expect(outcome.output).toMatchObject({ pipelineId: null, timedOut: true });
  }, 15_000);

  test("restart mid-wait resumes the gate from durable progress — the fix budget is not re-spent", async () => {
    const flowId = await harness.seedSdlcFlow();
    await testRun(`UPDATE flows SET mr_iid=$1, mr_branch=$2 WHERE id=$3`, 1, "devflow/ovh-gate-resume", flowId);
    const node = await claimGate(flowId);

    // the fake host holds a FAILING pipeline the crashed run already spent its
    // fix budget on (fixes = 3 = the default max_fix_attempts)
    gitHost.pipelines.set(7, { id: 7, status: "failed", sha: "sha_7" } as never);

    // the durable progress a crashed wait persisted (Zod-validated on read)
    const progress = {
      watchedId: 7,
      lastSeen: "7:failed",
      fixedIds: [7],
      triggerAttempted: false,
      fixWaitStart: null,
      manualPlays: {},
      fixes: 3,
      deadlineAt: Date.now() + 60_000,
    };
    await testRun(
      `INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,created_at)
       VALUES ('art_gate_resume',$1,$2,'gate_progress',1,$3,$4::jsonb,'draft',$5)`,
      node.id, flowId, JSON.stringify(progress), JSON.stringify(progress), db.now(),
    );

    const graph = await harness.graphForFlow(flowId);
    const spec = graph?.byKey.get("pipeline");
    if (!spec) throw new Error("expected a pipeline node");
    const def = await nodeRegistry.resolve(spec.defKey, "pipeline");
    const ctx = await flowEngine.ctx(flowId);

    // recover() re-enters the wait from the snapshot: the watched pipeline is
    // failed and the budget is spent — the resumed loop fails immediately
    // WITHOUT running another fix agent
    const recovery = await def.recover(ctx, node, { status: "finished", result: "" }, "server restarted mid-wait");
    expect(recovery).toEqual({ kind: "recovered" });

    expect(await harness.nodeStatus(flowId, "pipeline")).toBe("failed");
    // the durable budget was honored: no new fix-agent run was spent
    expect(gitHost.calls.some((c) => c.kind === "playJob")).toBe(false);
    const events = await testAll<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=$1 AND message LIKE '%still failing after 3 fix run(s)%'`,
      flowId,
    );
    expect(events.length).toBeGreaterThan(0);
  }, 15_000);

  test("restart mid-wait with a green watched pipeline resumes straight to done", async () => {
    const flowId = await harness.seedSdlcFlow();
    await testRun(`UPDATE flows SET mr_iid=$1, mr_branch=$2 WHERE id=$3`, 1, "devflow/ovh-gate-green", flowId);
    const node = await claimGate(flowId);

    gitHost.pipelines.set(9, { id: 9, status: "success", sha: "sha_9" } as never);
    const progress = {
      watchedId: 9,
      lastSeen: "9:running",
      fixedIds: [],
      triggerAttempted: false,
      fixWaitStart: null,
      manualPlays: {},
      fixes: 0,
      deadlineAt: Date.now() + 60_000,
    };
    await testRun(
      `INSERT INTO artifacts (id,node_id,flow_id,kind,version,content,meta,status,created_at)
       VALUES ('art_gate_green',$1,$2,'gate_progress',1,$3,$4::jsonb,'draft',$5)`,
      node.id, flowId, JSON.stringify(progress), JSON.stringify(progress), db.now(),
    );

    const graph = await harness.graphForFlow(flowId);
    const spec = graph?.byKey.get("pipeline");
    if (!spec) throw new Error("expected a pipeline node");
    const def = await nodeRegistry.resolve(spec.defKey, "pipeline");
    const ctx = await flowEngine.ctx(flowId);

    const recovery = await def.recover(ctx, node, { status: "finished", result: "" }, "server restarted mid-wait");
    expect(recovery).toEqual({ kind: "recovered" });
    expect(await harness.nodeStatus(flowId, "pipeline")).toBe("done");
    const out = await harness.nodeOutput(flowId, "pipeline");
    expect(out).toMatchObject({ pipelineId: 9, status: "success" });
  }, 15_000);
});
