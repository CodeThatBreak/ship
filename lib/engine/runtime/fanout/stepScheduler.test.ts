/**
 * StepScheduler (step 07 fan-out decomposition): the parallel_max slot
 * budget's qualification predicate — `overlaps` decides when an earlier
 * sibling serializes a candidate. Empty `files` lists are UNKNOWN ownership:
 * they overlap with everything (sequential), never count as independence.
 */
import { describe, expect, it } from "vitest";
import type { StepState } from "./types/stepState";
import type { StepScheduler } from "./stepScheduler";

const { stepFlows } = await import("./stepFlowManager");

/** the facade composes the scheduler (private member — test seam) */
const scheduler = (stepFlows as unknown as { scheduler: StepScheduler }).scheduler;
const overlapsOf = scheduler as unknown as {
  overlaps(a: StepState, b: StepState): boolean;
};

/** A minimal StepState: only `step.files` feeds the overlap predicate. */
const stateOf = (files: string[], position = 0): StepState => ({
  step: {
    id: `ps_${position}`,
    flowId: "flw_test",
    artifactId: null,
    metaId: null,
    position,
    title: `Step ${position}`,
    detail: null,
    files: JSON.stringify(files),
    branch: null,
    status: "pending",
    origin: "agent",
    completedBy: null,
    subFlowId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  childFlowId: `flw_child_${position}`,
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
});

describe("StepScheduler", () => {
  it("overlaps: shared file paths qualify (the earlier sibling serializes the candidate)", () => {
    expect(overlapsOf.overlaps(stateOf(["a.ts", "b.ts"]), stateOf(["b.ts", "c.ts"]))).toBe(true);
    expect(overlapsOf.overlaps(stateOf(["a.ts"]), stateOf(["c.ts"]))).toBe(false);
  });

  it("overlaps: an empty files list is unknown ownership — it overlaps everything", () => {
    expect(overlapsOf.overlaps(stateOf([]), stateOf(["a.ts"]))).toBe(true);
    expect(overlapsOf.overlaps(stateOf(["a.ts"]), stateOf([]))).toBe(true);
    expect(overlapsOf.overlaps(stateOf([]), stateOf([]))).toBe(true);
  });
});
