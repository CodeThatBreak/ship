import { describe, expect, it } from "vitest";
import { EventGrouper, flowEventNodeKeys, type FeedEvent } from "./groupEvents";

const baseEvent = (overrides: Partial<FeedEvent>): FeedEvent => ({
  id: "ev_1",
  flow_id: "flw_1",
  node_id: null,
  type: "lifecycle",
  message: "plan started (cloud)",
  data: null,
  created_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("EventGrouper", () => {
  it("reads run_id from parsed event data", () => {
    const grouper = new EventGrouper();
    const event = baseEvent({
      data: JSON.stringify({ run_id: "run_abc", mode: "cloud" }),
    });
    const sections = grouper.group([event]);
    expect(sections[0]?.runId).toBe("run_abc");
  });

  it("does not mutate input event rows (CR-197)", () => {
    const grouper = new EventGrouper();
    const event = baseEvent({
      data: JSON.stringify({ run_id: "run_abc", mode: "cloud" }),
    });
    const snapshot = structuredClone(event);
    grouper.group([event], new Map([["node_1", "plan"]]));
    expect(event).toEqual(snapshot);
  });
});

describe("flowEventNodeKeys", () => {
  it("returns nodeKey from flow-level event data", () => {
    const keys = flowEventNodeKeys(
      baseEvent({ data: JSON.stringify({ nodeKey: "pipeline_gate" }) }),
    );
    expect(keys).toEqual(["pipeline_gate"]);
  });
});
