import { describe, expect, it } from "vitest";
import type { FeedEvent } from "@/components/chat";
import { mergeFlowEvents } from "./merge-flow-events";

const ev = (id: string, created_at: string): FeedEvent => ({
  id,
  flow_id: "flw_1",
  node_id: null,
  type: "status",
  message: id,
  data: null,
  created_at,
});

describe("mergeFlowEvents", () => {
  it("appends only unseen ids and keeps chronological order", () => {
    const prev = [ev("a", "2026-01-01T00:00:00.000Z"), ev("b", "2026-01-01T00:00:01.000Z")];
    const incoming = [
      ev("b", "2026-01-01T00:00:01.000Z"),
      ev("c", "2026-01-01T00:00:02.000Z"),
    ];
    expect(mergeFlowEvents(prev, incoming, 500)).toEqual([
      ev("a", "2026-01-01T00:00:00.000Z"),
      ev("b", "2026-01-01T00:00:01.000Z"),
      ev("c", "2026-01-01T00:00:02.000Z"),
    ]);
  });

  it("caps the rolling window from the newest side", () => {
    const prev = [ev("a", "t0"), ev("b", "t1")];
    const incoming = [ev("c", "t2"), ev("d", "t3")];
    expect(mergeFlowEvents(prev, incoming, 3).map((e) => e.id)).toEqual(["b", "c", "d"]);
  });
});
