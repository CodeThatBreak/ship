/**
 * The split runtime facade (step 07 decomposition): the per-unit actions
 * (skip / retry / approve / cancel, addressed by unit.key), the actions'
 * consumer resolution, the Phase-4 knob layering, and the delegation seam —
 * the facade forwards the gate/expansion surface to the `SplitExpander` and
 * the scheduling/join surface to the `SplitJoin` (the class-level coverage
 * lives in each collaborator's co-located test).
 *
 * Runs against the isolated test database (AGENTS.md §1 — never a
 * demo/real database).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const {
  db,
  flowEngine,
  splitManager,
  setupSplitFixtures,
  seedParentFlow,
  setUnits,
  unit,
  consumerOf,
  until,
  joinSettled,
  engageConsumer,
  FixtureWorkerDef,
  AgentDefSchema,
  NODE_KEYS,
  nodeRegistry,
  splitConsumeOf,
  splitParallelMaxOf,
} = await import("../../../../tests/helpers/splitFixtureHarness");
const { SplitManager } = await import("./splitManager/splitManager");
const { SplitLinkageStore } = await import("./splitLinkageStore");

beforeAll(() => setupSplitFixtures());

describe("SplitManager — per-unit actions", () => {
  it("approveUnit releases the held unit and its dependents", async () => {
    const flowId = await seedParentFlow(401);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a", { item: { behavior: "hold" } }), unit("b", { dependsOn: ["a"] }), unit("c")], "split_worker_fixture");

    await engageConsumer(flowId);

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(async () => (await consumerOf(flowId)).units.some((u) => u.key === "a" && u.status === "awaiting_approval"), "the held unit");

    await splitManager.approveUnit(flowId, "split_consumer_fixture", "a");
    await until(joinSettled(flowId), "the approved join");

    const consumer = await consumerOf(flowId);
    expect(consumer.status).toBe("done");
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done", "c:done"]);
  });

  it("retryUnit re-runs a failed unit; the previously blocked dependents proceed", async () => {
    const flowId = await seedParentFlow(402);
    FixtureWorkerDef.reset();
    await setUnits(flowId, [unit("a", { item: { behavior: "fail-once" } }), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    await engageConsumer(flowId);

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(joinSettled(flowId), "the fail-once join");
    expect((await consumerOf(flowId)).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:failed", "b:blocked"]);

    await splitManager.retryUnit(flowId, "split_consumer_fixture", "a");
    await until(async () => (await consumerOf(flowId)).status === "done", "the retried join");

    expect(FixtureWorkerDef.runs.get("a")).toBe(2);
    expect((await consumerOf(flowId)).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:done", "b:done"]);
  });

  it("cancelUnit stops a held unit — it surfaces failed, dependents blocked", async () => {
    const flowId = await seedParentFlow(403);
    await setUnits(flowId, [unit("a", { item: { behavior: "hold" } }), unit("b", { dependsOn: ["a"] })], "split_worker_fixture");

    await engageConsumer(flowId);

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(async () => (await consumerOf(flowId)).units.some((u) => u.key === "a" && u.status === "awaiting_approval"), "the held unit");

    await splitManager.cancelUnit(flowId, "split_consumer_fixture", "a");
    await until(joinSettled(flowId), "the cancelled join");

    expect((await consumerOf(flowId)).units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:failed", "b:blocked"]);
  });

  it("skipUnit marks the unit skipped, blocks its dependents, and lets the rest proceed", async () => {
    const flowId = await seedParentFlow(404);
    await setUnits(flowId, [
      unit("a", { item: { behavior: "hold" } }),
      unit("b", { dependsOn: ["a"] }),
      unit("c"),
    ], "split_worker_fixture");

    await engageConsumer(flowId);

    await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture");
    await until(async () => (await consumerOf(flowId)).units.some((u) => u.key === "a" && u.status === "awaiting_approval"), "the held unit");

    await splitManager.skipUnit(flowId, "split_consumer_fixture", "a");
    await until(joinSettled(flowId), "the skipped join");

    const consumer = await consumerOf(flowId);
    expect(consumer.units.map((u) => `${u.key}:${u.status}`)).toEqual(["a:skipped", "b:blocked", "c:done"]);
    // a deliberate skip is not a failure — the consumer still resolves (decision 4)
    expect(consumer.status).toBe("done");
  });

  it("the per-unit actions resolve their consumer by unit key", async () => {
    const flowId = await seedParentFlow(801);
    await setUnits(flowId, [unit("a"), unit("b")], "split_worker_fixture");

    await engageConsumer(flowId);

    expect(await splitManager.expand(flowId, "split_consumer_fixture", "split_source_fixture")).toBe(true);
    expect(await splitManager.consumerOfUnit(flowId, "a")).toBe("split_consumer_fixture");
    expect(await splitManager.consumerOfUnit(flowId, "ghost")).toBeNull();
  });
});

// ── Phase 4: the consumer knob (agent-node split plan §2.4) ──────────────────

describe("Phase 4 knob placement — every def config still parses to today's defaults", () => {
  it("AgentDefSchema defaults: split_consume whole, split_parallel_max 1 (zero behavior change)", () => {
    const def = AgentDefSchema.parse({});
    expect(def.split_consume).toBe("whole");
    expect(def.split_parallel_max).toBe(1);
    // the Phase-3 split block still parses beside the new knobs
    const withSplit = AgentDefSchema.parse({ split: { field: "services" } });
    expect(withSplit.split).toMatchObject({ field: "services", key_field: "key" });
  });

  it("the built-in consumer defs parse unchanged and carry the knob at whole", async () => {
    for (const defKey of [NODE_KEYS.BUILD, NODE_KEYS.REVIEW, NODE_KEYS.RESOLVE, NODE_KEYS.PIPELINE]) {
      const def = nodeRegistry.all().find((d) => d.key === defKey);
      if (!def) throw new Error(`builtin def ${defKey} is not registered`);
      const parsed = def.configSchema.parse({}) as Record<string, unknown>;
      // build defers to its plan source's published resolution (Phase 6);
      // the other built-in consumers keep today's whole default
      expect(parsed.split_consume).toBe(defKey === NODE_KEYS.BUILD ? "source" : "whole");
      expect(parsed.split_parallel_max).toBe(1);
    }
    // spot-check that pre-existing defaults survived the new keys
    const build = await nodeRegistry.resolve(NODE_KEYS.BUILD);
    expect((build.configSchema.parse({}) as Record<string, unknown>).max_commit_fix_attempts).toBe(2);
    const review = await nodeRegistry.resolve(NODE_KEYS.REVIEW);
    expect((review.configSchema.parse({}) as Record<string, unknown>).comment_style).toBe("inline");
  });

  it("the defensive readers bow out on garbage (never throw a run down)", () => {
    expect(splitConsumeOf({ split_consume: "nonsense" })).toBe("whole");
    expect(splitConsumeOf(null)).toBe("whole");
    expect(splitParallelMaxOf({ split_parallel_max: 0 })).toBe(1);
    expect(splitParallelMaxOf({ split_parallel_max: "2" })).toBe(1);
    expect(splitParallelMaxOf(null)).toBe(1);
    expect(splitParallelMaxOf({ split_parallel_max: 3.7 })).toBe(3);
  });
});

describe("Phase 4 knob layering — class defaults ← app settings ← flow snapshot", () => {
  const DEF = "split_consumer_fixture";
  const SETTINGS_KEY = `node_config.${DEF}`;

  it("each layer wins over the one below, for both split knobs", async () => {
    // the template snapshot carries NO split knob (the seed default's
    // `per-unit` is overridden with undefined, which drops the JSON key), so
    // the class layer shows through first
    const flowId = await seedParentFlow(601, {
      consumerConfig: { split_consume: undefined, split_parallel_max: undefined },
    });
    const configOf = async () => flowEngine.nodeConfigFor(flowId, DEF);
    try {
      // class layer: the fixture def declares no config defaults — the knob
      // is simply ABSENT, and the defensive reader the gate uses resolves it
      // to whole (the zero-behavior default)
      expect(splitConsumeOf(await configOf())).toBe("whole");
      // the app-settings layer wins over the class layer
      await db.setSetting(SETTINGS_KEY, { split_consume: "per-unit", split_parallel_max: 3 });
      expect(await configOf()).toMatchObject({ split_consume: "per-unit", split_parallel_max: 3 });
      expect(splitParallelMaxOf(await configOf())).toBe(3);
      // the flow snapshot layer wins over both
      await flowEngine.setNodeConfig(flowId, DEF, { split_consume: "source", split_parallel_max: 2 });
      expect(await configOf()).toMatchObject({ split_consume: "source", split_parallel_max: 2 });
      expect(splitParallelMaxOf(await configOf())).toBe(2);
    } finally {
      await db.setSetting(SETTINGS_KEY, null); // never leak app-layer knobs into other tests
    }
  });
});

describe("SplitManager — the delegation seam (step 07)", () => {
  it("an unbound manager fails loud — the facade holds no logic of its own", async () => {
    const unbound = new SplitManager();
    await expect(unbound.stageGate("flw_unbound", "build")).rejects.toThrow(/not bound to the engine/);
  });

  it("the stage gate delegates through the expander (a bound stub engine decides)", async () => {
    // a whole-knob config short-circuits in the expander's stageSource — no
    // db read, no expansion: the facade added nothing to the path
    const stubEngine = {
      nodeConfigFor: async () => ({ split_consume: "whole" }),
    };
    const bound = new SplitManager();
    bound.bind(stubEngine as unknown as Parameters<typeof bound.bind>[0]);
    await expect(bound.stageGate("flw_whole_stub", "build")).resolves.toBe(false);
  });

  it("the default linkage seam is the flows-derived SplitLinkageStore", () => {
    const manager = new SplitManager() as unknown as { linkage: unknown };
    expect(manager.linkage).toBeInstanceOf(SplitLinkageStore);
  });
});
