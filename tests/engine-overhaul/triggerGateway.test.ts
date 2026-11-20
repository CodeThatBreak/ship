/**
 * TriggerGateway (engine overhaul step 06, Invariant 11): every trigger
 * source loses its duplicates at the same atomic claim door, every loser
 * emits one typed `skipped_duplicate_trigger` event carrying the source and
 * the holder's attempt, and every caller gets the same result-object
 * convention ({started} | {skipped, reason}) — no silent returns, no ad-hoc
 * throws for duplicates.
 *
 * The chain-guard characterization also pins here: the claim's folded
 * in-flight guard matches the old `chainBusy` predicate exactly (sibling
 * chain stages in `running` — nothing else ever blocked a trigger).
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { registerFakeGitHost } from "../helpers/fakeGitHost";
import { TRIGGER_SOURCE } from "@/lib/engine/runtime/triggers/constants/triggerSources";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");

registerFakeGitHost();
const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

const SKIP_CODE = "skipped_duplicate_trigger";

const skipEventsOf = async (flowId: string) =>
  db.all<{ data: { source?: string; holderAttemptId?: string | null; status?: string | null } }>(
    `SELECT data FROM events WHERE flow_id=$1 AND type=$2 ORDER BY created_at ASC`,
    flowId,
    SKIP_CODE,
  );

describe("TriggerGateway — one claim door, one skip convention", () => {
  test("every source skips the same way, each event naming its source", async () => {
    for (const source of Object.values(TRIGGER_SOURCE)) {
      const flowId = await harness.seedSdlcFlow();
      await db.run(`UPDATE flows SET mr_iid=$1, mr_branch=$2 WHERE id=$3`, 1, "devflow/ovh-gw", flowId);
      // the gate is mid-run: an in-flight pipeline wait owns it
      await harness.claimNode(flowId, "pipeline", "manualStage");

      const result = await flowEngine.triggerPipelineGate(flowId, undefined, undefined, source);
      expect(result).toEqual({ started: false, skipped: true, reason: SKIP_CODE });

      const skips = await skipEventsOf(flowId);
      expect(skips).toHaveLength(1);
      expect(skips[0]?.data.source).toBe(source);
      // the holder's attempt id names who owns the node
      expect(skips[0]?.data.holderAttemptId).toBeTruthy();
      // and the gate is still exactly one in-flight run (not re-claimed)
      expect(await harness.nodeStatus(flowId, "pipeline")).toBe("running");
    }
  });

  test("a won trigger returns {started} with the attempt token and claims the node", async () => {
    const flowId = await harness.seedSdlcFlow();
    await db.run(`UPDATE flows SET mr_iid=$1, mr_branch=$2 WHERE id=$3`, 1, "devflow/ovh-gw2", flowId);

    const result = await flowEngine.triggerPipelineGate(flowId, undefined, undefined, TRIGGER_SOURCE.UI);
    expect(result.started).toBe(true);
    if (!result.started) throw new Error("unreachable");
    expect(result.attemptId).toMatch(/^att_/);
    expect(await harness.nodeStatus(flowId, "pipeline")).toBe("running");
    expect((await skipEventsOf(flowId)).length).toBe(0);
  });

  test("the chain guard matches the old chainBusy predicate: a running sibling blocks, nothing else does", async () => {
    const flowId = await harness.seedSdlcFlow();
    await db.run(`UPDATE flows SET mr_iid=$1, mr_branch=$2 WHERE id=$3`, 1, "devflow/ovh-gw3", flowId);
    await harness.claimNode(flowId, "pipeline", "manualStage");

    // review + resolve lose while the gate runs (the old chainBusy read)
    const review = await flowEngine.triggerReview(flowId, undefined, TRIGGER_SOURCE.POLLER);
    expect(review).toEqual({ started: false, skipped: true, reason: SKIP_CODE });
    const resolve = await flowEngine.triggerResolve(flowId, undefined, TRIGGER_SOURCE.WEBHOOK);
    expect(resolve).toEqual({ started: false, skipped: true, reason: SKIP_CODE });
    expect(await harness.nodeStatus(flowId, "review")).not.toBe("running");
    expect(await harness.nodeStatus(flowId, "resolve")).not.toBe("running");

    // and a terminal (done) sibling never blocked a trigger — the gate's own
    // claim decides, the chain guard only looks at `running`
    await flowEngine.cancelNode(flowId, "pipeline");
    const gateAgain = await flowEngine.triggerPipelineGate(flowId, undefined, undefined, TRIGGER_SOURCE.UI);
    expect(gateAgain.started).toBe(true);
  });

  test("approval doors use the same result object and emit the same skip event", async () => {
    const flowId = await harness.seedSdlcFlow();
    const buildKey = await flowEngine.keyOfRole(flowId, "build");
    if (!buildKey) throw new Error("expected build key");
    // the build is not awaiting approval — the approve transition's from-set
    // refuses the stale click with the same typed skip
    const result = await flowEngine.approveBuild(flowId);
    expect(result).toEqual({ started: false, skipped: true, reason: SKIP_CODE });
    const skips = await skipEventsOf(flowId);
    expect(skips.length).toBeGreaterThan(0);
    expect(skips[0]?.data.status).toBeTruthy();
  });
});
