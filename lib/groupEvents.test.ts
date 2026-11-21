import { describe, expect, it } from "vitest";
import { EventGrouper, flowEventNodeKeys, type FeedEvent } from "./groupEvents";

const baseEvent = (overrides: Partial<FeedEvent>): FeedEvent => ({
  id: "ev_1",
  flowId: "flw_1",
  nodeId: null,
  type: "lifecycle",
  message: "plan started (cloud)",
  data: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("EventGrouper", () => {
  it("reads run_id from parsed event data", () => {
    const grouper = new EventGrouper();
    const event = baseEvent({
      data: { run_id: "run_abc", mode: "cloud" },
    });
    const sections = grouper.group([event]);
    expect(sections[0]?.runId).toBe("run_abc");
  });

  it("does not mutate input event rows (CR-197)", () => {
    const grouper = new EventGrouper();
    const event = baseEvent({
      data: { run_id: "run_abc", mode: "cloud" },
    });
    const snapshot = structuredClone(event);
    grouper.group([event], new Map([["node_1", "plan"]]));
    expect(event).toEqual(snapshot);
  });
});

describe("flowEventNodeKeys", () => {
  it("returns nodeKey from flow-level event data", () => {
    const keys = flowEventNodeKeys(
      baseEvent({ data: { nodeKey: "pipeline_gate" } }),
    );
    expect(keys).toEqual(["pipeline_gate"]);
  });
});
