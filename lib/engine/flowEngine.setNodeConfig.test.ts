/**
 * Task 05 — `set_node_config` for not-yet-started nodes + the typed
 * `config_updated` event: a `pending`/`failed` node accepts the edit (the
 * snapshot persists and the event names the changed keys), a `running`/`done`
 * node rejects with the typed ConflictError, and the next run's config read
 * (`nodeConfigFor` — the same read the stage runner performs) picks the edit
 * up. The template's snapshot semantics are untouched: this edits THIS flow's
 * `nodes.config` layer only.
 *
 * Runs against the isolated test database (AGENTS.md §1 — never a
 * demo/real database).
 */
import { testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../db/app");
const { FlowEngine } = await import("./flowEngine/flowEngine");
const { ConflictError, ERROR_CODE } = await import("../errors");
const { NODE_STATUS } = await import("./constants/nodeStatus");
const { NODE_KEYS } = await import("./constants/nodeKeys");
const { EVENT_KIND } = await import("./constants/vocabulary");

const now = () => new Date().toISOString();

beforeAll(async () => {
  await resetTestDatabase();
});

/** One isolated task + flow (the seeded SDLC template) with one `plan` node
 *  in the given status. */
const seedFlowWithPlan = async (index: number, status: string): Promise<string> => {
  const flowId = `flw_cfg_${index}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_${flowId}`, "generic", `CFG-${index}`, "config test", "open", "task", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    flowId, `task_${flowId}`, `config test ${index}`, "active", now(), now(),
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `node_${flowId}_plan`, flowId, NODE_KEYS.PLAN, NODE_KEYS.PLAN, status, now(), now(),
  );
  return flowId;
};

const engine = new FlowEngine();

describe("setNodeConfig — the not-yet-started guard (task 05)", () => {
  it("a pending node accepts the edit: snapshot persisted, config_updated emitted with the changed keys", async () => {
    const flowId = await seedFlowWithPlan(1, NODE_STATUS.PENDING);

    await engine.setNodeConfig(flowId, NODE_KEYS.PLAN, { execution_default: "follow" });

    const row = await testGet<{ config: unknown }>(
      `SELECT config FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, NODE_KEYS.PLAN,
    );
    // JSONB comes back from $queryRawUnsafe already parsed
    const snapshot = (typeof row?.config === "string" ? JSON.parse(row.config) : row?.config ?? {}) as Record<string, unknown>;
    expect(snapshot.execution_default).toBe("follow");

    const event = await db.prisma.event.findFirst({
      where: { flowId, type: EVENT_KIND.CONFIG_UPDATED },
    });
    expect(event).not.toBeNull();
    expect(event?.message).toBe(`${NODE_KEYS.PLAN} config updated`);
    const data = (event?.data ?? {}) as Record<string, unknown>;
    expect(data.changedKeys).toEqual(["execution_default"]);
    expect(data.nodeKey).toBe(NODE_KEYS.PLAN);
  });

  it("a failed node accepts the edit (fix the knobs, then retry)", async () => {
    const flowId = await seedFlowWithPlan(2, NODE_STATUS.FAILED);

    await engine.setNodeConfig(flowId, NODE_KEYS.PLAN, { execution_default: "follow" });

    const row = await testGet<{ config: unknown }>(
      `SELECT config FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, NODE_KEYS.PLAN,
    );
    // JSONB comes back from $queryRawUnsafe already parsed
    const snapshot = (typeof row?.config === "string" ? JSON.parse(row.config) : row?.config ?? {}) as Record<string, unknown>;
    expect(snapshot.execution_default).toBe("follow");
  });

  it("a running node rejects with the typed conflict", async () => {
    const flowId = await seedFlowWithPlan(3, NODE_STATUS.RUNNING);

    await expect(engine.setNodeConfig(flowId, NODE_KEYS.PLAN, { execution_default: "follow" }))
      .rejects.toThrow(ConflictError);
    await expect(engine.setNodeConfig(flowId, NODE_KEYS.PLAN, { execution_default: "follow" }))
      .rejects.toMatchObject({ code: ERROR_CODE.CONFLICT, status: 409 });
  });

  it("a done node rejects with the typed conflict", async () => {
    const flowId = await seedFlowWithPlan(4, NODE_STATUS.DONE);

    await expect(engine.setNodeConfig(flowId, NODE_KEYS.PLAN, { execution_default: "follow" }))
      .rejects.toThrow(ConflictError);
  });

  it("the next run re-reads the edited snapshot: the run-time config read carries the edit", async () => {
    const flowId = await seedFlowWithPlan(5, NODE_STATUS.PENDING);

    await engine.setNodeConfig(flowId, NODE_KEYS.PLAN, { execution_default: "follow" });

    // the same merged read the stage runner performs at run time
    // (stageRunner: def.parseRunConfig(await host.nodeConfigFor(...)))
    const effective = await engine.nodeConfigFor(flowId, NODE_KEYS.PLAN);
    expect(effective.execution_default).toBe("follow");
  });
});
