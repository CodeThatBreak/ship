import { describe, expect, it } from "vitest";
import { FLOW_STATUS } from "@/constants/flow";
import { isNodeFirstRun } from "@/components/flows/panels/hooks/useNodePromptPrefill";

/**
 * The composer prefill's first-run gate (docs/make-agentic-node-consistent.md
 * Phase 2) mirrors the engine's `AgentRunNode.isFirstTurn`: the pre-send turn
 * carries the prompt body; turns after a run are refine feedback.
 */
describe("isNodeFirstRun", () => {
  it("a never-run node awaiting its first run is a first turn", () => {
    expect(
      isNodeFirstRun({ output: null, status: FLOW_STATUS.PENDING }),
    ).toBe(true);
  });

  it("a failed node with no output is still a first turn (the retry is a fresh run)", () => {
    expect(
      isNodeFirstRun({ output: null, status: FLOW_STATUS.FAILED }),
    ).toBe(true);
  });

  it("a node that published an output is refine turns — even when it failed after", () => {
    expect(
      isNodeFirstRun({ output: { reply: "x" }, status: FLOW_STATUS.FAILED }),
    ).toBe(false);
    expect(
      isNodeFirstRun({ output: { reply: "x" }, status: FLOW_STATUS.DONE }),
    ).toBe(false);
  });

  it("a running or finished never-output node is not a first turn", () => {
    expect(
      isNodeFirstRun({ output: null, status: FLOW_STATUS.RUNNING }),
    ).toBe(false);
    expect(
      isNodeFirstRun({ output: null, status: FLOW_STATUS.AWAITING_APPROVAL }),
    ).toBe(false);
  });
});
