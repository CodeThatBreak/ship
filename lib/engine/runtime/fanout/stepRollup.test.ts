/**
 * StepRollup (step 07 fan-out decomposition): the fan-out join. Covered here:
 * the pure derivations — the child node-set rollup (failed >
 * awaiting_approval > running > done) and the aggregate entry status
 * (`aggregateStatus`, which keeps stalled pending steps honest as `failed`).
 */
import { describe, expect, it } from "vitest";
import type { StepState } from "./types/stepState";
import type { StepRollup } from "./stepRollup";

const { stepFlows } = await import("./stepFlowManager");
const { StepRollup: rollupClass } = await import("./stepRollup");
/** the facade composes the rollup (private member — test seam) */
const rollup = (stepFlows as unknown as { rollup: StepRollup }).rollup;
const aggregateStatusOf = rollup as unknown as {
  aggregateStatus(s: StepState): "done" | "failed" | "skipped";
};

/** A minimal StepState: only the rollup-relevant flags feed the derivations. */
const stateOf = (overrides: Partial<StepState> = {}): StepState => ({
  step: {
    id: "ps_0",
    flowId: "flw_test",
    artifactId: null,
    metaId: null,
    position: 0,
    title: "Step",
    detail: null,
    files: "[]",
    branch: null,
    status: "pending",
    origin: "agent",
    completedBy: null,
    subFlowId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  childFlowId: "flw_child_0",
  childStatus: null,
  childNodeKey: null,
  childNodeType: null,
  childNodeStatus: null,
  branch: null,
  integrationBranch: null,
  isCodeChild: false,
  isRunning: false,
  isAwaiting: false,
  isResolved: false,
  isFailed: false,
  mergeStatus: null,
  mergeAttempts: 0,
  mergeError: null,
  staleBase: false,
  ...overrides,
});

describe("StepRollup", () => {
  it("childRollup: failed > awaiting_approval > running > done (worst-of the child's nodes)", () => {
    expect(rollupClass.childRollup(["done", "failed"], null)).toBe("failed");
    expect(rollupClass.childRollup(["running", "awaiting_approval"], null)).toBe("awaiting_approval");
    expect(rollupClass.childRollup(["running", "done"], null)).toBe("running");
    expect(rollupClass.childRollup(["done", "approved", "skipped"], null)).toBe("done");
    expect(rollupClass.childRollup(["pending"], null)).toBeNull();
    expect(rollupClass.childRollup(["pending"], "done")).toBe("done"); // the closed flow settles it
    expect(rollupClass.childRollup([], null)).toBeNull();
  });

  it("aggregateStatus: skipped / failed / done, with stalled unstarted pendings honest as failed", () => {
    expect(aggregateStatusOf.aggregateStatus(stateOf({ step: { ...stateOf().step, completedBy: "skipped" } }))).toBe("skipped");
    expect(aggregateStatusOf.aggregateStatus(stateOf({ isFailed: true }))).toBe("failed");
    // a pending step whose child never started (stalled by a failed sibling) is failed, not silently done
    expect(aggregateStatusOf.aggregateStatus(stateOf({ childFlowId: null }))).toBe("failed");
    expect(aggregateStatusOf.aggregateStatus(stateOf({ step: { ...stateOf().step, status: "done" } }))).toBe("done");
    // a linked child whose work node failed shows through on a still-pending step
    expect(aggregateStatusOf.aggregateStatus(stateOf({ childNodeStatus: "failed" }))).toBe("failed");
  });

  it("captureAggregateAttempt records the expand-time attempt token for the publish fence", () => {
    const attempts = rollup as unknown as { aggregateAttempts: Map<string, string> };
    rollup.captureAggregateAttempt("flw_fence", "build", "att_1");
    expect(attempts.aggregateAttempts.get("flw_fence\nbuild")).toBe("att_1");
  });
});
