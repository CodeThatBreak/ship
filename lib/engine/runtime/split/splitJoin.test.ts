/**
 * SplitJoin (step 07 split decomposition): the dependsOn/slot scheduler and
 * the aggregate join. Covered here: the pure unit-status rollup (skipped >
 * failed > awaiting_approval > running > done > pending), the expand-time
 * attempt-token capture that fences the aggregate publish, the scheduling
 * order (parallel_max 1 vs N — no file-overlap inference), the failure
 * semantics (a failed unit blocks its dependents; non-dependents proceed)
 * and the unit-order aggregate publication.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const {
  db,
  splitManager,
  setupSplitFixtures,
  seedParentFlow,
  setUnits,
  unit,
  childFlowsOf,
  consumerOf,
  until,
  joinSettled,
  engageConsumer,
  FixtureWorkerDef,
  must,
} = await import("../../../../tests/helpers/splitFixtureHarness");
const { SplitJoin } = await import("./splitJoin");
type SplitJoinClass = InstanceType<typeof SplitJoin>;

beforeAll(() => setupSplitFixtures());

/** the facade composes the join (private member — test seam) */
const join = (splitManager as unknown as { join: SplitJoinClass }).join;

describe("SplitJoin (pure derivations)", () => {
  it("unitStatusOf: skipped > failed > awaiting_approval > running > done > pending", () => {
    expect(SplitJoin.unitStatusOf(["done", "failed"], null)).toBe("failed");
    expect(SplitJoin.unitStatusOf(["running", "awaiting_approval"], null)).toBe("awaiting_approval");
    expect(SplitJoin.unitStatusOf(["running", "done"], null)).toBe("running");
    expect(SplitJoin.unitStatusOf(["done", "approved", "skipped"], null)).toBe("done");
    expect(SplitJoin.unitStatusOf(["pending"], null)).toBe("pending");
    expect(SplitJoin.unitStatusOf(["pending"], "done")).toBe("done"); // the closed flow settles it
    expect(SplitJoin.unitStatusOf(["done"], "skipped")).toBe("skipped"); // the flow-level marker wins
    expect(SplitJoin.unitStatusOf([], null)).toBe("pending");
  });

  it("captureAttempt records the expand-time attempt token for the publish fence", () => {
    join.captureAttempt("flw_fence", "build", "att_1");
    const attempts = join as unknown as { consumerAttempts: Map<string, string> };
    expect(attempts.consumerAttempts.get("flw_fence\nbuild")).toBe("att_1");
  });
});

describe("SplitJoin — scheduling (deps + slot)", () => {
  it("parallel_max 1: a later independent unit yields to an earlier dependent", async () => {
    const flowId = await seedParentFlow(201);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a"), unit("c", { dependsOn: ["a"] }), unit("b")], "split_worker_fixture");

    await engageConsumer(flowId);

    // the children exist only after expansion (the expander hands off to the
    // join's scheduler); a second advance pass is the guarded no-op path
    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await join.advance(flowId, "split_consumer_fixture");
    await until(joinSettled(flowId), "the serial join");

    // b (no deps) waits twice: behind a's slot, then behind c (earlier position)
    expect(FixtureWorkerDef.started).toEqual(["a", "c", "b"]);
    expect((await consumerOf(flowId)).units.map((u) => u.status)).toEqual(["done", "done", "done"]);
  });

  it("parallel_max 2: independents start together (no file-overlap inference)", async () => {
    const flowId = await seedParentFlow(202, { consumerConfig: { split_parallel_max: 2 } });
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a"), unit("c", { dependsOn: ["a"] }), unit("b")], "split_worker_fixture");

    await engageConsumer(flowId);

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await join.advance(flowId, "split_consumer_fixture");
    await until(joinSettled(flowId), "the parallel join");

    // the free slot lets b start beside a, before its dependent c. a and b
    // race concurrent start chains through the async persistence layer, so
    // only the set and "the dependent starts last" are deterministic —
    // never an incidental a-vs-b order.
    expect([...FixtureWorkerDef.started].sort()).toEqual(["a", "b", "c"]);
    expect(FixtureWorkerDef.started.indexOf("c")).toBe(2);
  });

  it("a unit depending on an unknown key never starts — it surfaces blocked, the join still publishes", async () => {
    const flowId = await seedParentFlow(203);
    await setUnits(flowId, [unit("a", { dependsOn: ["ghost"] })], "split_worker_fixture");

    await engageConsumer(flowId);

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await join.advance(flowId, "split_consumer_fixture");
    await until(joinSettled(flowId), "the ghost-dep join");

    expect((await consumerOf(flowId)).units).toEqual([
      expect.objectContaining({ key: "a", status: "blocked" }),
    ]);
  });
});

describe("SplitJoin — failure semantics + join", () => {
  it("a failed unit blocks its dependents; non-dependents proceed; the join surfaces it all", async () => {
    const flowId = await seedParentFlow(301);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [
      unit("a", { item: { behavior: "fail" } }),
      unit("c", { dependsOn: ["a"] }),
      unit("b"),
    ], "split_worker_fixture");

    await engageConsumer(flowId);

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await join.advance(flowId, "split_consumer_fixture");
    await until(joinSettled(flowId), "the failed join");

    const consumer = await consumerOf(flowId);
    expect(consumer.status).toBe("failed"); // worst-of (decision 4)
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:failed", "c:blocked", "b:done"]);
    // the blocked dependent was never started
    const cChild = must((await childFlowsOf(flowId)).find((c) => c.unitKey === "c"), "child c");
    expect((await db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=$1`, cChild.id))?.status).toBe("pending");
    expect(FixtureWorkerDef.started).toEqual(["a", "b"]);
  });

  it("the aggregate publishes in unit order (positions), not completion order", async () => {
    const flowId = await seedParentFlow(302, { consumerConfig: { split_parallel_max: 3 } });
    await setUnits(flowId, [unit("z"), unit("m"), unit("a")], "split_worker_fixture");

    await engageConsumer(flowId);

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await join.advance(flowId, "split_consumer_fixture");
    await until(joinSettled(flowId), "the ordered join");

    expect((await consumerOf(flowId)).units.map((u) => u.key)).toEqual(["z", "m", "a"]);
  });
});
