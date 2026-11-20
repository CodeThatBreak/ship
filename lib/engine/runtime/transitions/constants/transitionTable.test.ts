import { describe, expect, it } from "vitest";
import { TRANSITION_TABLE } from "./transitionTable";
import { isClaimKey, isDeclaredPair, resolveToStatus, toStatusOf } from "../utils/transitionLookup";
import type { TransitionKey, TransitionRow } from "../types/transitions";
import { NODE_STATUS } from "../../../constants/nodeStatus";

/**
 * The declared node state machine (step-02 acceptance): every declared
 * from→to pair is accepted, a sample of undeclared pairs is rejected, and the
 * table's shape rules hold (actors from the vocabulary, claims are the only
 * transitions into `running`).
 */
describe("transitionTable", () => {
  it("every declared from→to pair is accepted", () => {
    for (const [key, row] of Object.entries(TRANSITION_TABLE)) {
      for (const from of row.from) {
        for (const to of row.to) {
          expect(isDeclaredPair(key as TransitionKey, from, to), `${key}: ${from} → ${to}`).toBe(true);
        }
      }
    }
  });

  it("rejects undeclared pairs (the state machine is closed)", () => {
    expect(isDeclaredPair("approve", NODE_STATUS.PENDING, NODE_STATUS.APPROVED)).toBe(false);
    expect(isDeclaredPair("runFromPending", NODE_STATUS.DONE, NODE_STATUS.RUNNING)).toBe(false);
    expect(isDeclaredPair("outcome", NODE_STATUS.DONE, NODE_STATUS.RUNNING)).toBe(false);
    expect(isDeclaredPair("cancel", NODE_STATUS.APPROVED, NODE_STATUS.FAILED)).toBe(false);
    expect(isDeclaredPair("loopReentry", NODE_STATUS.RUNNING, NODE_STATUS.PENDING)).toBe(false);
  });

  it("resolveToStatus throws on undeclared targets and unchosen multi-target rows", () => {
    expect(() => resolveToStatus("approve", NODE_STATUS.DONE)).toThrow(/cannot target/);
    expect(() => resolveToStatus("chatRevert")).toThrow(/several declared targets/);
    expect(resolveToStatus("chatRevert", NODE_STATUS.DONE)).toBe(NODE_STATUS.DONE);
    expect(resolveToStatus("approve")).toBe(NODE_STATUS.APPROVED);
  });

  it("toStatusOf narrows untyped target strings loudly", () => {
    expect(toStatusOf("chatRevert", "done")).toBe(NODE_STATUS.DONE);
    expect(() => toStatusOf("approve", "pending")).toThrow(/cannot target/);
  });

  it("every row declares an actor from the vocabulary and non-empty sets", () => {
    for (const row of Object.values(TRANSITION_TABLE)) {
      expect(["trigger", "effect", "reconcile", "user", "system", "agent"]).toContain(row.actor);
      expect(row.from.length).toBeGreaterThan(0);
      expect(row.to.length).toBeGreaterThan(0);
    }
  });

  it("claims are the only transitions into running", () => {
    for (const [key, entry] of Object.entries(TRANSITION_TABLE)) {
      const row: TransitionRow = entry;
      if (row.to.includes(NODE_STATUS.RUNNING)) {
        expect(row.to, `${key} must only target running`).toEqual([NODE_STATUS.RUNNING]);
      }
    }
    expect(isClaimKey("runFromPending")).toBe(true);
    expect(isClaimKey("commitFix")).toBe(true);
    expect(isClaimKey("approve")).toBe(false);
  });
});
