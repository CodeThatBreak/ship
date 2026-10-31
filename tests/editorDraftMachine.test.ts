import { describe, expect, it } from "vitest";

import type { Draft } from "@/components/templateEditor/draft";
import {
  planDraftHistoryAfterMutation,
  SNAPSHOT_COALESCE_MS,
} from "@/components/templateEditor/utils/draftHistory";

const baseDraft = (): Draft =>
  ({
    template: {
      id: "t1",
      name: "Test",
      description: null,
      version: 1,
      is_builtin: false,
      trigger: { type: "manual" },
    },
    pendingDefs: {},
    nodes: [{ key: "a", nodeTemplateId: "nt1" } as Draft["nodes"][0]],
    edges: [{ from: "a", to: "b", kind: "next", label: null, condition: null }],
  }) as Draft;

describe("planDraftHistoryAfterMutation", () => {
  it("clears redo on every mutation even when undo is coalesced (CR-139)", () => {
    const cur = baseDraft();
    const next = {
      ...cur,
      nodes: [...cur.nodes, { key: "b", nodeTemplateId: "nt2" } as Draft["nodes"][0]],
    };
    const t0 = 1_000;
    const first = planDraftHistoryAfterMutation(cur, next, { undo: [], redo: [{ ...cur }], lastSnapAt: 0 }, t0);
    expect(first.redo).toEqual([]);
    expect(first.undo).toHaveLength(1);

    const second = planDraftHistoryAfterMutation(
      next,
      { ...next, nodes: [...next.nodes, { key: "c", nodeTemplateId: "nt3" } as Draft["nodes"][0]] },
      { ...first, redo: [{ ...cur }] },
      t0 + SNAPSHOT_COALESCE_MS - 1,
    );
    expect(second.redo).toEqual([]);
    expect(second.undo).toHaveLength(1);
  });

  it("pushes a new undo snapshot after the coalesce window (CR-133 companion)", () => {
    const cur = baseDraft();
    const mid = {
      ...cur,
      nodes: [...cur.nodes, { key: "b", nodeTemplateId: "nt2" } as Draft["nodes"][0]],
    };
    const t0 = 5_000;
    const first = planDraftHistoryAfterMutation(cur, mid, { undo: [], redo: [], lastSnapAt: 0 }, t0);
    const second = planDraftHistoryAfterMutation(
      mid,
      { ...mid, nodes: mid.nodes.filter((n) => n.key !== "b") },
      first,
      t0 + SNAPSHOT_COALESCE_MS + 1,
    );
    expect(second.undo).toHaveLength(2);
  });
});
