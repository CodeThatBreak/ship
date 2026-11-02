import { describe, expect, it } from "vitest";
import { buildThreads } from "./buildThreads";
import type { MrComment } from "../../hooks/useFlowComments";

const comment = (overrides: Partial<MrComment> & Pick<MrComment, "id">): MrComment => ({
  body: "body",
  status: "open",
  resolvable: true,
  resolved: false,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("buildThreads", () => {
  it("groups replies under the earliest note in a thread", () => {
    const threads = buildThreads([
      comment({ id: "b", threadId: "t1", createdAt: "2026-01-02T00:00:00Z", body: "reply" }),
      comment({ id: "a", threadId: "t1", createdAt: "2026-01-01T00:00:00Z", body: "root" }),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.root.id).toBe("a");
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(["b"]);
  });

  it("sorts threads newest root first", () => {
    const threads = buildThreads([
      comment({ id: "old", threadId: "t-old", createdAt: "2026-01-01T00:00:00Z" }),
      comment({ id: "new", threadId: "t-new", createdAt: "2026-02-01T00:00:00Z" }),
    ]);

    expect(threads.map((t) => t.id)).toEqual(["t-new", "t-old"]);
  });

  it("treats missing threadId as standalone threads", () => {
    const threads = buildThreads([
      comment({ id: "solo", createdAt: "2026-01-01T00:00:00Z" }),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.id).toBe("ind_solo");
  });
});
