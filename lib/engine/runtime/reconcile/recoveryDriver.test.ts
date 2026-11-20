/**
 * RecoveryDriver + the fixed `recover()` ABI (step 05, Invariant 4): the
 * driver walks an expired `running` node to recovered-or-manual through the
 * REAL engine seam (`FlowEngine.completeNodeFromResult`), where a def's
 * `recover()` throw is caught ONCE and mapped to `manual` + an error event —
 * the reconciler pass never sees a recovery throw. A live RUN lease means
 * another process is heartbeating the run: the driver must not touch it.
 *
 * Real engine + real DB rows; three fixture defs registered in the node
 * registry decide the `recover()` outcome (recovered / manual / throw). The
 * local agent port is a stub — `inspectSession` answers from a queued probe,
 * so no SDK runtime is contacted.
 *
 * Runs against the isolated dockerized Postgres via `assignTestDatabase()` /
 * `resetTestDatabase()` (tests/helpers/testDatabase).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { assignTestDatabase, resetTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../db/app");
const { RecoveryDriver } = await import("./recoveryDriver");
const { flowEngine } = await import("../../flowEngine");
const { NodeDefinition } = await import("../../nodes/shared/nodeDefinition");
const { nodeRegistry } = await import("../../nodes/registry");
const { agentPortRegistry } = await import("../../ports/agentPort");
const { NODE_STATUS } = await import("../../constants/nodeStatus");
import type {
  AgentPort,
  AgentRunQuery,
  AgentRunResult,
  AgentRunUsage,
  AgentStarted,
  AgentStreamOutcome,
} from "../../ports/agentPort";
import type { RunOutcome } from "../../nodes/shared/nodeDefinition";
import type { FlowCtx } from "../../nodes/shared/nodeSharedExports";
import type { RecoveryResult } from "../../nodes/shared/types/recovery";
import type { FlowRow, NodeRow } from "../../../db/rows";

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
const must = <T,>(row: T | undefined, what: string): T => {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
};

// ── stub local agent port (the restart probe; hermetic) ──────────────────────

/** Queued `inspectSession` probes; an empty queue makes the probe THROW so a
 *  test proves the driver never called it. `hasActiveRun` reads a set the
 *  tests populate explicitly. */
class StubLocalAgentPort implements AgentPort {
  readonly kind = "stub-recovery-local";
  readonly label = "Stub recovery local";
  readonly execMode = "local" as const;
  readonly harness = "stub";
  readonly fallbackModels = [];
  readonly listDiscount = 0;

  private readonly probes: ({ completed: boolean; text: string } | null)[] = [];

  queueProbe(probe: { completed: boolean; text: string } | null): void {
    this.probes.push(probe);
  }

  /** Clear queued probes — per-test isolation. */
  reset(): void {
    this.probes.length = 0;
  }

  async inspectSession(): Promise<{ completed: boolean; text: string } | null> {
    const probe = this.probes.shift();
    if (probe == null) throw new Error("stub inspectSession called with an empty probe queue");
    return probe;
  }

  /** No run is owned by THIS process in these tests — the probe decides. */
  hasActiveRun(): boolean {
    return false;
  }

  start(): Promise<AgentStarted> {
    return Promise.reject(new Error("stub-recovery-local.start must not be called"));
  }

  stream(): Promise<AgentStreamOutcome> {
    return Promise.reject(new Error("stub-recovery-local.stream must not be called"));
  }

  getRun(): Promise<AgentRunQuery> {
    return Promise.reject(new Error("stub-recovery-local.getRun must not be called"));
  }

  cancel(): Promise<boolean> {
    return Promise.reject(new Error("stub-recovery-local.cancel must not be called"));
  }

  releaseActiveRun(): void {}

  getUsage(): Promise<AgentRunUsage | null> {
    return Promise.reject(new Error("stub-recovery-local.getUsage must not be called"));
  }

  listCatalog(): Promise<null> {
    return Promise.reject(new Error("stub-recovery-local.listCatalog must not be called"));
  }

  status(): Promise<{ configured: boolean }> {
    return Promise.reject(new Error("stub-recovery-local.status must not be called"));
  }
}

const stubPort = new StubLocalAgentPort();
agentPortRegistry.register(stubPort);

// ── fixture defs: one per recover() outcome, registered in the registry ──────

const FIXTURE_RECOVERED = "recovery_fixture_recovered";
const FIXTURE_MANUAL = "recovery_fixture_manual";
const FIXTURE_THROWING = "recovery_fixture_throws";
const MANUAL_REASON = "ledger meta unparseable";

/** Base: schemas are permissive records — recovery, not the run, is under test. */
abstract class RecoveryFixtureDef extends NodeDefinition<Record<string, unknown>, Record<string, unknown>> {
  readonly promptKeys = [];
  readonly order = 901;
  readonly inputSchema = z.record(z.string(), z.unknown());
  readonly outputSchema = z.record(z.string(), z.unknown());

  async run(): Promise<RunOutcome> {
    throw new Error("a recovery fixture never runs in-process");
  }
}

/** recover() re-applies the recorded outcome through the one persistence path
 *  and reports `recovered` — the node lands on its success terminal. */
class RecoveredFixtureDef extends RecoveryFixtureDef {
  readonly key = FIXTURE_RECOVERED;
  readonly label = "Recovery fixture (recovered)";

  async recover(ctx: FlowCtx, node: NodeRow): Promise<RecoveryResult> {
    await this.applyOutcome(ctx, {
      status: NODE_STATUS.DONE,
      output: {},
      event: `${node.nodeKey} finished (recovered)`,
      reply: "",
    });
    return { kind: "recovered" };
  }
}

/** recover() cannot rebuild a terminal from the recorded state — `manual`
 *  with the reason the run trail must carry. */
class ManualFixtureDef extends RecoveryFixtureDef {
  readonly key = FIXTURE_MANUAL;
  readonly label = "Recovery fixture (manual)";

  async recover(): Promise<RecoveryResult> {
    return { kind: "manual", reason: MANUAL_REASON };
  }
}

/** A def whose recover() throws anyway — the seam must catch it ONCE. */
class ThrowingFixtureDef extends RecoveryFixtureDef {
  readonly key = FIXTURE_THROWING;
  readonly label = "Recovery fixture (throws)";

  async recover(): Promise<RecoveryResult> {
    throw new Error(MANUAL_REASON);
  }
}

for (const def of [new RecoveredFixtureDef(), new ManualFixtureDef(), new ThrowingFixtureDef()]) {
  if (!nodeRegistry.has(def.key)) nodeRegistry.register(def);
}

// ── seeding: flow (local mode, a repo with a local path) + running node + run ─

interface SeededRecovery {
  readonly flowId: string;
  readonly nodeId: string;
  readonly runRef: string;
}

let runSeq = 0;

/** Seed the durable state the driver reconciles from: an expired-node-lease
 *  `running` node of the fixture kind, plus its (expired-lease) run row. The
 *  run lease is `live` when the test wants the driver to back off. */
const seedRecoveryNode = async (fixtureKey: string, opts: { runLeaseLive: boolean }): Promise<SeededRecovery> => {
  stubPort.reset();
  runSeq += 1;
  const flowId = `flw_rd_${runSeq}`;
  const nodeId = db.uid("node_");
  const runRef = `run_rd_${runSeq}`;
  await db.run(
    `INSERT INTO repos (id, name, cloud_url, local_path, created_at, updated_at)
     VALUES ($1,$2,$3,$4,now(),now())`,
    `repo_${flowId}`, `repo ${flowId}`, `https://git.example/${flowId}.git`, "/tmp/devflow-recovery-fixture",
  );
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_${flowId}`, "generic", flowId.toUpperCase(), "recovery driver test", "open", "task", "P2",
  );
  await db.run(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, repo_id, created_at, updated_at)
     VALUES ($1,$2,$3,'active','local',$4,now(),now())`,
    flowId, `task_${flowId}`, "t", `repo_${flowId}`,
  );
  await db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'running',now(),now())`,
    nodeId, flowId, fixtureKey, fixtureKey,
  );
  // the node lease lapsed — the driver is what should now own the node
  await db.run(`UPDATE nodes SET lease_until = now() - interval '5 minutes' WHERE id=$1`, nodeId);
  await db.run(
    `INSERT INTO runs (id, flow_id, node_id, agent_ref, run_ref, status, lease_until, created_at, updated_at)
     VALUES ($1,$2,$3,'sess_recovery',$4,'running',$5,now(),now())`,
    db.uid("run_"), flowId, nodeId, runRef,
    opts.runLeaseLive ? new Date(Date.now() + 120_000) : new Date(Date.now() - 120_000),
  );
  return { flowId, nodeId, runRef };
};

/** The flow row the driver entry takes, with the mapped fields it reads. */
const flowRowOf = async (flowId: string): Promise<FlowRow> => {
  const row = await db.get<{ id: string; executionMode: string }>(
    `SELECT id, execution_mode AS "executionMode" FROM flows WHERE id=$1`,
    flowId,
  );
  if (row == null) throw new Error(`missing row: flow ${flowId}`);
  return row as unknown as FlowRow;
};

const nodeStatusOf = async (nodeId: string): Promise<string | undefined> =>
  (await db.get<{ status: string }>(`SELECT status FROM nodes WHERE id=$1`, nodeId))?.status;

const errorEventsOf = async (flowId: string): Promise<{ message: string }[]> =>
  await db.all<{ message: string }>(`SELECT message FROM events WHERE flow_id=$1 AND type='error' ORDER BY created_at`, flowId);

const runStatusOf = async (nodeId: string): Promise<string | undefined> =>
  (await db.get<{ status: string }>(`SELECT status FROM runs WHERE node_id=$1 ORDER BY created_at DESC LIMIT 1`, nodeId))?.status;

describe("RecoveryDriver — the fixed recover() ABI at the recovery seam (Invariant 4)", () => {
  const driver = new RecoveryDriver();

  beforeAll(async () => {
    await resetTestDatabase();
    // forMode("local") selects the stub port via the harness preference
    await db.setSetting("default_harness", "stub");
  });

  it("a def whose recover() resolves recovered completes the node — no fail event", async () => {
    const { flowId, nodeId } = await seedRecoveryNode(FIXTURE_RECOVERED, { runLeaseLive: false });
    stubPort.queueProbe({ completed: true, text: "the turn had finished" });

    await driver.recover(await flowRowOf(flowId), { id: nodeId, nodeKey: FIXTURE_RECOVERED });

    // the fixture re-applied its outcome through the authority — the node is
    // on its success terminal, and the trail carries no failure
    expect(await nodeStatusOf(nodeId)).toBe(NODE_STATUS.DONE);
    expect(await runStatusOf(nodeId)).toBe("finished");
    expect(await errorEventsOf(flowId)).toEqual([]);
  });

  it("a def whose recover() resolves manual fails the node and the trail carries the reason", async () => {
    const { flowId, nodeId } = await seedRecoveryNode(FIXTURE_MANUAL, { runLeaseLive: false });
    stubPort.queueProbe({ completed: true, text: "the turn had finished" });

    await driver.recover(await flowRowOf(flowId), { id: nodeId, nodeKey: FIXTURE_MANUAL });

    expect(await nodeStatusOf(nodeId)).toBe(NODE_STATUS.FAILED);
    const errors = await errorEventsOf(flowId);
    expect(errors.length).toBe(1);
    expect(errors[0]?.message).toContain(`recovery is manual (${MANUAL_REASON})`);
    expect(errors[0]?.message).toContain("retry the node to continue");
  });

  it("a def whose recover() THROWS is mapped ONCE to manual + an error event — the driver never rejects", async () => {
    const { flowId, nodeId } = await seedRecoveryNode(FIXTURE_THROWING, { runLeaseLive: false });
    stubPort.queueProbe({ completed: true, text: "the turn had finished" });

    // Invariant-4 seam: the whole recovery path resolves — the reconciler
    // pass never observes the def's throw
    await expect(driver.recover(await flowRowOf(flowId), { id: nodeId, nodeKey: FIXTURE_THROWING })).resolves.toBeUndefined();

    expect(await nodeStatusOf(nodeId)).toBe(NODE_STATUS.FAILED);
    const errors = await errorEventsOf(flowId);
    // exactly ONE throw→manual mapping: the typed throw event, then the
    // manual failure it mapped to
    expect(errors.map((e) => e.message).filter((m) => m.includes("recover() threw — recovery failed"))).toEqual([
      `${FIXTURE_THROWING} recover() threw — recovery failed: ${MANUAL_REASON}`,
    ]);
    expect(errors.map((e) => e.message).filter((m) => m.includes("recovery is manual"))).toEqual([
      `${FIXTURE_THROWING} recovery is manual (recover() threw: ${MANUAL_REASON}) — retry the node to continue`,
    ]);
  });

  it("a node whose run lease is still live is left alone (the run's owner is alive)", async () => {
    const { flowId, nodeId } = await seedRecoveryNode(FIXTURE_RECOVERED, { runLeaseLive: true });
    // an empty probe queue makes inspectSession THROW — proving the driver
    // never even probed the session
    stubPort.queueProbe(null);

    await driver.recover(await flowRowOf(flowId), { id: nodeId, nodeKey: FIXTURE_RECOVERED });

    expect(await nodeStatusOf(nodeId)).toBe("running");
    expect(await runStatusOf(nodeId)).toBe("running");
    expect(await errorEventsOf(flowId)).toEqual([]);
  });

  it("an unfinished session probe (server died mid-turn) fails the node manually", async () => {
    const { flowId, nodeId } = await seedRecoveryNode(FIXTURE_MANUAL, { runLeaseLive: false });
    stubPort.queueProbe({ completed: false, text: "" });

    await driver.recover(await flowRowOf(flowId), { id: nodeId, nodeKey: FIXTURE_MANUAL });

    // the probe says the turn never finished — the orphan path, not the def
    expect(await nodeStatusOf(nodeId)).toBe(NODE_STATUS.FAILED);
    const errors = await errorEventsOf(flowId);
    expect(errors[0]?.message).toContain("the agent session shows an unfinished turn");
    // the def's recover() was never reached — no manual-reason mapping
    expect(errors.map((e) => e.message).filter((m) => m.includes("recovery is manual"))).toEqual([]);
  });

  it("completeNodeFromResult maps a throwing recover() to manual through the same seam (direct engine call)", async () => {
    // direct seam-level check without the lease/probe walk: the engine API
    // the driver (and cloud re-attach) calls resolves on a throwing def
    const { flowId, nodeId } = await seedRecoveryNode(FIXTURE_THROWING, { runLeaseLive: false });
    const ctx: FlowCtx = await flowEngine.ctx(flowId);
    const node = must(
      await db.get<{ id: string; nodeKey: string; status: string; attemptId: null }>(
        `SELECT id, node_key AS "nodeKey", status, attempt_id AS "attemptId" FROM nodes WHERE id=$1`,
        nodeId,
      ),
      "node row",
    );

    await expect(
      flowEngine.completeNodeFromResult(
        ctx,
        node as unknown as NodeRow,
        { status: "finished", result: "text" } satisfies AgentRunResult,
        "reconciled from the git/agent API",
      ),
    ).resolves.toBe(true);

    expect(await nodeStatusOf(nodeId)).toBe(NODE_STATUS.FAILED);
    const errors = await errorEventsOf(flowId);
    expect(errors.map((e) => e.message).filter((m) => m.includes("recover() threw — recovery failed"))).toEqual([
      `${FIXTURE_THROWING} recover() threw — recovery failed: ${MANUAL_REASON}`,
    ]);
  });
});
