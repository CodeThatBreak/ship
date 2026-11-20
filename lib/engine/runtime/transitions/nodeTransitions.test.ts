import { testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../db/app");
const { NodeAttemptRegistry } = await import("../nodeAttemptRegistry");
const { TransitionAuthority } = await import("./nodeTransitions");
const { TransitionEvents } = await import("./transitionEvents");
const { RunSupersededError } = await import("../../errors/runSupersededError");
const { ConflictError } = await import("../../../errors");
const { NODE_STATUS } = await import("../../constants/nodeStatus");

/**
 * The transition authority's write contract (Invariant 1): claims stamp
 * attempts, keyed applies respect from-sets, outcomes are attempt-fenced in
 * one statement with the output, and the in-memory log records every applied
 * transition for the test helper's declared-table assert.
 */

const seedFlow = async (flowId: string): Promise<void> => {
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_${flowId}`, "generic", flowId.toUpperCase(), "authority test", "open", "task", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
    flowId, `task_${flowId}`, "t", "active",
  );
};

const seedNode = async (flowId: string, nodeKey: string, status: string): Promise<string> => {
  const nodeId = db.uid("node_");
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,'agent',$4,now(),now())`,
    nodeId, flowId, nodeKey, status,
  );
  return nodeId;
};

describe("TransitionAuthority", () => {
  let authority: InstanceType<typeof TransitionAuthority>;

  beforeAll(async () => {
    await resetTestDatabase();
    authority = new TransitionAuthority(new NodeAttemptRegistry(), new TransitionEvents());
  });

  it("claim stamps running + a fresh attempt and marks the registry", async () => {
    const flowId = "flw_ta_claim";
    await seedFlow(flowId);
    const nodeId = await seedNode(flowId, "build", NODE_STATUS.PENDING);
    const { attemptId } = await authority.claim(flowId, "build", "runFromPending");
    expect(attemptId).toMatch(/^att_/);
    expect(
      await testGet<{ status: string; attemptId: string | null }>(
        `SELECT status, attempt_id AS "attemptId" FROM nodes WHERE id=$1`, nodeId),
    ).toMatchObject({ status: NODE_STATUS.RUNNING, attemptId: attemptId });
    expect(authority.records(flowId).some((r) => r.key === "runFromPending" && r.attemptId === attemptId)).toBe(true);
  });

  it("claim rejects a node outside the declared from-set", async () => {
    const flowId = "flw_ta_conflict";
    await seedFlow(flowId);
    await seedNode(flowId, "build", NODE_STATUS.DONE);
    await expect(authority.claim(flowId, "build", "runFromPending")).rejects.toThrow(ConflictError);
  });

  it("apply respects the from-set, clears the attempt and returns false on a miss", async () => {
    const flowId = "flw_ta_apply";
    await seedFlow(flowId);
    const nodeId = await seedNode(flowId, "gate", NODE_STATUS.WAITING);
    expect(await authority.apply(flowId, "gate", "cancel")).toBe(true);
    expect(
      await testGet<{ status: string; attemptId: string | null }>(
        `SELECT status, attempt_id AS "attemptId" FROM nodes WHERE id=$1`, nodeId),
    ).toMatchObject({ status: NODE_STATUS.FAILED, attemptId: null });
    // already failed — the from-set misses, fire-and-forget callers see false
    expect(await authority.apply(flowId, "gate", "cancel")).toBe(false);
    await expect(authority.applyOrThrow(flowId, "gate", "cancel")).rejects.toThrow(ConflictError);
  });

  it("apply refuses claim-shaped keys (only claim writes running)", async () => {
    const flowId = "flw_ta_claimkey";
    await seedFlow(flowId);
    await seedNode(flowId, "build", NODE_STATUS.PENDING);
    await expect(authority.apply(flowId, "build", "runFromPending")).rejects.toThrow(/claim it instead/);
  });

  it("publishOutcome writes status + output in one attempt-fenced statement", async () => {
    const flowId = "flw_ta_outcome";
    await seedFlow(flowId);
    const nodeId = await seedNode(flowId, "agent", NODE_STATUS.PENDING);
    const { attemptId } = await authority.claim(flowId, "agent", "runFromPending");
    await authority.publishOutcome({
      flowId, nodeKey: "agent", nodeId, attemptId,
      outcome: { status: NODE_STATUS.DONE, output: { answer: 42 }, agentId: "agent_x" },
    });
    const row = await testGet<{ status: string; attemptId: string | null; output: unknown; agentId: string | null }>(
      `SELECT status, attempt_id AS "attemptId", output, agent_id AS "agentId" FROM nodes WHERE id=$1`, nodeId);
    expect(row).toMatchObject({ status: NODE_STATUS.DONE, attemptId: null, agentId: "agent_x" });
    expect((row?.output as { answer?: number }).answer).toBe(42);
  });

  it("publishOutcome throws RunSupersededError when the attempt no longer matches", async () => {
    const flowId = "flw_ta_superseded";
    await seedFlow(flowId);
    const nodeId = await seedNode(flowId, "agent", NODE_STATUS.PENDING);
    const { attemptId } = await authority.claim(flowId, "agent", "runFromPending");
    // a retry superseded the first attempt
    await authority.apply(flowId, "agent", "chatRevert", { toStatus: NODE_STATUS.FAILED });
    await authority.claim(flowId, "agent", "retry");
    await expect(authority.publishOutcome({
      flowId, nodeKey: "agent", nodeId, attemptId,
      outcome: { status: NODE_STATUS.DONE, output: {} },
    })).rejects.toThrow(RunSupersededError);
  });

  it("publishOutcome rejects an undeclared target status", async () => {
    const flowId = "flw_ta_undeclared";
    await seedFlow(flowId);
    const nodeId = await seedNode(flowId, "agent", NODE_STATUS.PENDING);
    await authority.claim(flowId, "agent", "runFromPending");
    await expect(authority.publishOutcome({
      flowId, nodeKey: "agent", nodeId,
      outcome: { status: NODE_STATUS.APPROVED, output: {} },
    })).rejects.toThrow(/cannot target/);
  });

  it("publishAggregate: a stale aggregate loses to a re-claim; its own held/failed states republish", async () => {
    const flowId = "flw_ta_aggregate";
    await seedFlow(flowId);
    await seedNode(flowId, "split", NODE_STATUS.PENDING);
    const original = await authority.claim(flowId, "split", "runFromPending");
    // the user retried the node: revert → failed, then a FRESH claim
    await authority.apply(flowId, "split", "chatRevert", { toStatus: NODE_STATUS.FAILED });
    await authority.claim(flowId, "split", "retry");
    // the stale aggregate carries the ORIGINAL run's attempt — it must lose
    expect(await authority.publishAggregate(flowId, "split", "splitOutcome", {
      status: NODE_STATUS.DONE, output: { units: [] }, attemptId: original.attemptId,
    })).toBe(false);
    expect(await testGet<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=$1 AND node_key='split'`, flowId))
      .toMatchObject({ status: NODE_STATUS.RUNNING });
    // the aggregate's own held/failed states (attempt cleared by its own
    // earlier publish) republish — the per-unit retry path depends on it
    await authority.apply(flowId, "split", "chatRevert", { toStatus: NODE_STATUS.FAILED });
    expect(await authority.publishAggregate(flowId, "split", "splitOutcome", {
      status: NODE_STATUS.DONE, output: { units: [] }, attemptId: original.attemptId,
    })).toBe(true);
  });

  it("transitionFenced reverts a claimed node to its pre-claim status", async () => {
    const flowId = "flw_ta_revert";
    await seedFlow(flowId);
    const nodeId = await seedNode(flowId, "plan", NODE_STATUS.AWAITING_APPROVAL);
    const { attemptId } = await authority.claim(flowId, "plan", "chatRefine");
    await authority.transitionFenced({
      flowId, nodeKey: "plan", nodeId, attemptId,
      key: "chatRevert", toStatus: NODE_STATUS.AWAITING_APPROVAL, patch: { agent_id: "agent_y" },
    });
    expect(
      await testGet<{ status: string; agentId: string | null }>(
        `SELECT status, agent_id AS "agentId" FROM nodes WHERE id=$1`, nodeId),
    ).toMatchObject({ status: NODE_STATUS.AWAITING_APPROVAL, agentId: "agent_y" });
  });

  it("applyFlowScope skips every non-terminal node of a flow in one statement", async () => {
    const flowId = "flw_ta_scope";
    await seedFlow(flowId);
    await seedNode(flowId, "unit_a", NODE_STATUS.PENDING);
    await seedNode(flowId, "unit_b", NODE_STATUS.APPROVED);
    await seedNode(flowId, "unit_c", NODE_STATUS.DONE);
    const affected = await authority.applyFlowScope(flowId, "skipUnit");
    expect(affected.sort()).toEqual(["unit_a", "unit_b"]);
    expect(
      await testGet<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=$1 AND node_key='unit_c'`, flowId),
    ).toMatchObject({ status: NODE_STATUS.DONE });
  });

  it("failFromRunning silently skips a node that already moved on", async () => {
    const flowId = "flw_ta_fail";
    await seedFlow(flowId);
    await seedNode(flowId, "gate", NODE_STATUS.PENDING);
    await authority.claim(flowId, "gate", "runFromPending");
    await authority.failFromRunning(flowId, "gate");
    expect(await testGet<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=$1 AND node_key='gate'`, flowId))
      .toMatchObject({ status: NODE_STATUS.FAILED });
    // second call: no longer running — silent no-op, no throw
    await authority.failFromRunning(flowId, "gate");
  });

});
