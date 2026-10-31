import { describe, expect, it } from "vitest";
import { layout } from "@/components/flows/workflow-graph/graph-layout";

describe("graph layout", () => {
  it("lays out only edges whose endpoints exist in the node key set", () => {
    const keys = ["a", "b", "c"];
    const edges: [string, string, string][] = [
      ["a", "b", "forward"],
      ["b", "missing", "forward"],
      ["ghost", "a", "forward"],
    ];
    const g = layout(keys, edges);
    expect(g.hasEdge("a", "b")).toBe(true);
    expect(g.hasEdge("b", "missing")).toBe(false);
    expect(g.hasEdge("ghost", "a")).toBe(false);
  });

  it("returns stable positions for the same topology", () => {
    const keys = ["start", "end"];
    const edges: [string, string, string][] = [["start", "end", "forward"]];
    const g1 = layout(keys, edges);
    const g2 = layout(keys, edges);
    expect(g1.node("start")).toEqual(g2.node("start"));
    expect(g1.node("end")).toEqual(g2.node("end"));
  });
});
