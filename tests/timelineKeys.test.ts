import { describe, expect, it } from "vitest";
import {
  feedItemKey,
  runSectionTimelineKey,
  timelineRowKey,
} from "@/components/chat/timelineKeys";
import type { FeedItem, RunSection } from "@/lib/groupEvents";

describe("timeline keys", () => {
  it("keys feed items by tool, group, or event id", () => {
    const tool: FeedItem = {
      kind: "tool",
      tool: { key: "call-1", name: "read", status: "ok", events: [] },
    };
    expect(feedItemKey(tool)).toBe("tcall-1");
  });

  it("keys run sections by section key and first item anchor", () => {
    const section: RunSection = {
      key: "run-1",
      label: "build",
      active: false,
      items: [
        {
          kind: "event",
          event: {
            id: "ev-99",
            flow_id: "f",
            node_id: "n",
            type: "lifecycle",
            message: null,
            data: null,
            created_at: "2020-01-01T00:00:00Z",
          },
        },
      ],
    };
    expect(runSectionTimelineKey(section)).toBe("rrun-1@eev-99");
  });

  it("keys timeline rows without index qualification", () => {
    expect(
      timelineRowKey({
        kind: "msg",
        t: 0,
        msg: {
          id: "m1",
          role: "user",
          content: "hi",
          created_at: "",
        },
      }),
    ).toBe("mm1");
  });
});
