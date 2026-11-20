/**
 * T3 (node-definition refactor, phase 4): engine dispatch routes by def
 * metadata, not literal built-in keys. Covered here: the engine paths —
 * `keyOfRole` / `gateKey` over the seeded SDLC template, and the `approveNode`
 * guard built-in approvals now ride the flag (the registry-side catalog
 * contract lives in `nodes/registry.test.ts`).
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database).
 */
import { testAll, testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { StepRollup } from "./runtime/fanout/stepRollup";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";

// Must run before any `../db` import touches the connection — dynamic imports
// below execute in statement order after the static ones hoist.
assignTestDatabase();

const { db } = await import("../db/app");
const { FlowEngine } = await import("./flowEngine/flowEngine");
const { stepFlows } = await import("./runtime/fanout/stepFlowManager");
// the pin module's tail binds stepFlows/splitManager to the shared engine —
// loading the class alone (the split moved the bind to the pin, the old
// monolith's module tail) leaves the rollup's engine reference unset
await import("./flowEngine");
const { ERROR_CODE } = await import("../errors");
const { NODE_KEYS } = await import("./constants/nodeKeys");
const { templateStore } = await import("./templates/templateStore");

/** the aggregate publish moved off FlowEngine into the fan-out runtime's
 *  StepRollup (step 07) — tests drive it through the bound facade's rollup */
const rollup = (stepFlows as unknown as { rollup: StepRollup }).rollup;

const now = () => new Date().toISOString();

beforeAll(resetTestDatabase);

/** One isolated task + flow on the seeded SDLC template (template_id null). */
async function seedFlow(index: number): Promise<string> {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `TST-${index}`, "metadata test", "open", "task", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    flowId, taskId, `metadata test ${index}`, "active", now(), now(),
  );
  return flowId;
}

describe("engine chain-role routing (T3)", () => {
  const engine = new FlowEngine();

  it("keyOfRole resolves the flow's node for a chain role through the metadata", async () => {
    const flowId = await seedFlow(1);
    const expected = (await templateStore.graphForFlow(flowId))?.nodes
      .find((n) => n.defKey === NODE_KEYS.PLAN)?.key ?? null;
    expect(expected).not.toBeNull(); // the seeded SDLC template has a plan role
    expect(await engine.keyOfRole(flowId, NODE_KEYS.PLAN)).toBe(expected);
    expect(await engine.keyOfRole(flowId, NODE_KEYS.RESOLVE)).toBe(
      (await templateStore.graphForFlow(flowId))?.nodes.find((n) => n.defKey === NODE_KEYS.RESOLVE)?.key ?? null,
    );
  });

  it("gateKey resolves the CI gate through the pipeline def's wait source", async () => {
    const flowId = await seedFlow(2);
    const expected = await templateStore.waitNodeKey(flowId, NODE_KEYS.PIPELINE);
    expect(expected).not.toBeNull(); // the seeded SDLC template has a gate
    expect(await engine.gateKey(flowId)).toBe(expected);
  });

  it("delete throws NotFoundError when the flow id is missing", async () => {
    await expect(engine.delete("flw_missing")).rejects.toMatchObject({
      status: 404,
      code: ERROR_CODE.NOT_FOUND,
      message: "flow flw_missing not found",
    });
  });

  it("plan and build approvals belong to their built-in flow actions (the flag, not the key)", async () => {
    const flowId = await seedFlow(3);
    for (const [nodeKey, type] of [[NODE_KEYS.PLAN, NODE_KEYS.PLAN], [NODE_KEYS.BUILD, NODE_KEYS.BUILD]] as const) {
      await testRun(
        `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        `node_${flowId}_${nodeKey}`, flowId, nodeKey, type, "awaiting_approval", now(), now(),
      );
      await expect(engine.approvals.approveNode(flowId, nodeKey))
        .rejects.toThrow(`${nodeKey} approval belongs to its built-in flow actions`);
    }
  });

  it("rolls back flow rows when node insert fails mid-create (CR-012)", async () => {
    const taskId = "task_create_txn";
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId, "jira", "CREATE-TXN", "txn test", "open", "task", "P2",
    );
    // node rows ride the tx client's ORM delegate now (decision Q1) — fail the
    // second node create inside the transaction and let the whole create roll back
    const origTransaction = db.transaction.bind(db);
    let nodeCreates = 0;
    const txSpy = vi.spyOn(db, "transaction").mockImplementation((fn, tx) =>
      origTransaction(async (exec) => {
        if (tx) return fn(tx);
        const failing = new Proxy(exec, {
          get(target, prop) {
            if (prop === "node") {
              return new Proxy(target.node, {
                get(nTarget, m, nReceiver) {
                  if (m === "create") {
                    const orig = Reflect.get(nTarget, m, nReceiver) as (args: unknown) => Promise<unknown>;
                    return (args: unknown) => {
                      nodeCreates += 1;
                      if (nodeCreates === 2) {
                        return Promise.reject(new Error("simulated node insert failure"));
                      }
                      return orig.call(nTarget, args);
                    };
                  }
                  return Reflect.get(nTarget, m, nReceiver);
                },
              }) as typeof target.node;
            }
            return Reflect.get(target, prop);
          },
        }) as typeof exec;
        return fn(failing);
      }),
    );
    try {
      await expect(engine.create(taskId, "https://example.com/repo.git")).rejects.toThrow("simulated node insert failure");
    } finally {
      txSpy.mockRestore();
    }
    expect(await testAll(`SELECT id FROM flows WHERE task_id=$1`, taskId)).toHaveLength(0);
    expect(await testAll(`SELECT id FROM nodes WHERE flow_id IN (SELECT id FROM flows WHERE task_id=$1)`, taskId)).toHaveLength(0);
  });

  it("sendChat refuses a second refine while the plan node is already running", async () => {
    const flowId = await seedFlow(4);
    const planKey = await engine.keyOfRole(flowId, NODE_KEYS.PLAN);
    if (!planKey) throw new Error("expected plan key");
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, attempt_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      `node_${flowId}_plan`,
      flowId,
      planKey,
      NODE_KEYS.PLAN,
      "running",
      "att_busy",
      now(),
      now(),
    );
    // step 06 (Invariant 11): the duplicate loses the atomic claim and emits
    // the typed skip event — no throw, and the node stays running
    const result = await engine.chats.sendChat(flowId, planKey, "second message");
    expect(result).toEqual({ started: false, skipped: true, reason: "skipped_duplicate_trigger" });
    const skips = await testAll(
      `SELECT type FROM events WHERE flow_id=$1 AND type='skipped_duplicate_trigger'`,
      flowId,
    );
    expect(skips.length).toBeGreaterThan(0);
    expect((await testGet<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, `node_${flowId}_plan`))?.status).toBe("running");
  });

  it("approvePlan skips when the plan node is running (refine in flight)", async () => {
    const flowId = await seedFlow(5);
    const planKey = await engine.keyOfRole(flowId, NODE_KEYS.PLAN);
    if (!planKey) throw new Error("expected plan key");
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, attempt_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      `node_${flowId}_plan`,
      flowId,
      planKey,
      NODE_KEYS.PLAN,
      "running",
      "att_refine",
      now(),
      now(),
    );
    // the approve door needs the plan artifact present (it is validated
    // before the transition); with it seeded, the running node loses the
    // approve transition atomically and emits the typed skip event
    await testRun(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      `art_${flowId}`, `node_${flowId}_plan`, flowId, "plan", 1, "{}", "draft", now(),
    );
    const result = await engine.approvals.approvePlan(flowId);
    expect(result).toEqual({ started: false, skipped: true, reason: "skipped_duplicate_trigger" });
    const skips = await testAll(
      `SELECT type FROM events WHERE flow_id=$1 AND type='skipped_duplicate_trigger'`,
      flowId,
    );
    expect(skips.length).toBeGreaterThan(0);
  });

  it("triggerResolve re-runs when the resolve node is already done", async () => {
    const flowId = await seedFlow(7);
    const resolveKey = await engine.keyOfRole(flowId, NODE_KEYS.RESOLVE);
    if (!resolveKey) throw new Error("expected resolve key");
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      `node_${flowId}_resolve`,
      flowId,
      resolveKey,
      NODE_KEYS.RESOLVE,
      "done",
      now(),
      now(),
    );
    vi.spyOn(engine, "bg").mockImplementation(() => {});
    await engine.chain.triggerResolve(flowId);
    expect(
      (
        await testGet<{ status: string }>(
          `SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`,
          flowId,
          resolveKey,
        )
      )?.status,
    ).toBe("running");
  });

  it("finishFanout does not regress a parent node after the aggregate is already published (CR-009)", async () => {
    const flowId = await seedFlow(6);
    const buildKey = await engine.keyOfRole(flowId, NODE_KEYS.BUILD);
    if (!buildKey) throw new Error("expected build key");
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      `node_${flowId}_build`,
      flowId,
      buildKey,
      NODE_KEYS.BUILD,
      "running",
      now(),
      now(),
    );
    const aggregate = {
      steps: [{ id: "s1", title: "Step", status: "done" as const, output: {} }],
    };
    await rollup.finishFanout(flowId, buildKey, aggregate);
    const afterFirst = await testGet<{ status: string; output: string | null }>(
      `SELECT status, output FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, buildKey);
    expect(afterFirst?.status).toBe("awaiting_approval");

    await rollup.finishFanout(flowId, buildKey, {
      steps: [{ id: "s2", title: "Retry", status: "failed" as const, output: {} }],
    });
    const afterSecond = await testGet<{ status: string; output: string | null }>(
      `SELECT status, output FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, buildKey);
    expect(afterSecond?.status).toBe(afterFirst?.status);
    // JSONB column: each read surfaces a fresh object — compare the payload,
    // not the reference (the sqlite TEXT column made `toBe` work)
    expect(afterSecond?.output).toEqual(afterFirst?.output);
  });
});

describe("ingestComments", () => {
  const engine = new FlowEngine();

  it("stores mr_iid on new comment rows", async () => {
    const flowId = await seedFlow(50);
    const n = await engine.ingest.ingestComments(flowId, [{
      id: "host-c1",
      threadId: "t1",
      author: "reviewer",
      body: "change this",
      path: "a.ts",
      line: 1,
      resolved: false,
      system: false,
      resolvable: true,
      createdAt: now(),
    }], 7);
    expect(n).toBe(1);
    expect(
      (await testGet<{ mrIid: number | null }>(`SELECT mr_iid AS "mrIid" FROM comments WHERE id=$1`, "host-c1"))?.mrIid,
    ).toBe(7);
  });
});
