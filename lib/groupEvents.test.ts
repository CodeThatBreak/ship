import { describe, expect, it } from "vitest";
import { ACTIVITY_GROUP } from "@/constants/events";
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

describe("activity groups", () => {
  const worktreeEvent = (
    id: string,
    message: string,
    createdAt: string,
    nodeId = "node_1",
  ): FeedEvent =>
    baseEvent({
      id,
      nodeId,
      type: "lifecycle",
      message,
      data: { nodeKey: "build", activityGroup: ACTIVITY_GROUP.WORKTREE },
      createdAt,
    });

  it("keeps worktree setup and creation in one section despite a long gap", () => {
    const sections = new EventGrouper().group(
      [
        worktreeEvent("ev_1", "setting up worktree (branch fix)…", "2026-01-01T00:00:00.000Z"),
        worktreeEvent("ev_2", "worktree created at /w (branch fix)", "2026-01-01T00:05:00.000Z"),
      ],
      new Map([["node_1", "build"]]),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]?.label).toBe("Worktree related");
    expect(sections[0]?.nodeKey).toBe("build");
    expect(sections[0]?.items.map((item) => (item.kind === "event" ? item.event.id : item.kind))).toEqual([
      "ev_1",
      "ev_2",
    ]);
  });

  it("does not merge worktree activity from different nodes", () => {
    const sections = new EventGrouper().group([
      worktreeEvent("ev_1", "setting up worktree…", "2026-01-01T00:00:00.000Z", "node_1"),
      worktreeEvent("ev_2", "setting up worktree…", "2026-01-01T00:00:01.000Z", "node_2"),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[0]?.key).not.toBe(sections[1]?.key);
  });

  it("leaves untagged lifecycle events on the legacy path", () => {
    const sections = new EventGrouper().group([
      baseEvent({ id: "ev_1", data: { nodeKey: "build" } }),
      baseEvent({ id: "ev_2", data: { nodeKey: "build" } }),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.label).toBe("flow activity");
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
