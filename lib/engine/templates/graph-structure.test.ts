import { describe, expect, it } from "vitest";
import {
  lintGraphStructure,
  type GraphStructureEdge,
  type GraphStructureNode,
} from "./graph-structure";

const agent = (key: string): GraphStructureNode => ({
  key,
  nodeTemplateId: "nt_agent",
});

const resolve = (node: GraphStructureNode) => {
  if (node.nodeTemplateId === "nt_agent") {
    return { kind: "agent", key: "agent_tpl", isBuiltin: false };
  }
  if (node.nodeTemplateId === "nt_dec") {
    return {
      kind: "decision",
      key: "dec_tpl",
      isBuiltin: false,
      decisionChoices: ["a", "b"],
    };
  }
  return null;
};

describe("lintGraphStructure", () => {
  it("rejects next-edge cycles (CR-062)", () => {
    const nodes = [agent("a"), agent("b")];
    const edges: GraphStructureEdge[] = [
      { from: "a", to: "b", kind: "next" },
      { from: "b", to: "a", kind: "next" },
    ];
    const problems = lintGraphStructure(nodes, edges, resolve);
    expect(problems.some((p) => p.message.includes("loop edge"))).toBe(true);
  });

  it("rejects labels on non-decision edges (CR-063)", () => {
    const nodes = [agent("a"), agent("b")];
    const edges: GraphStructureEdge[] = [{ from: "a", to: "b", kind: "next", label: "x" }];
    const problems = lintGraphStructure(nodes, edges, resolve);
    expect(problems.some((p) => p.message.includes("decision"))).toBe(true);
  });

  it("rejects conditions on decision out-edges (CR-063)", () => {
    const nodes = [
      { key: "d", nodeTemplateId: "nt_dec" },
      agent("b"),
    ];
    const edges: GraphStructureEdge[] = [
      { from: "d", to: "b", kind: "next", label: "a", condition: "true" },
    ];
    const problems = lintGraphStructure(nodes, edges, resolve);
    expect(problems.some((p) => p.message.includes("label"))).toBe(true);
  });

  it("rejects duplicate edges using the save dedupe tuple", () => {
    const nodes = [agent("a"), agent("b")];
    const edges: GraphStructureEdge[] = [
      { from: "a", to: "b", kind: "next" },
      { from: "a", to: "b", kind: "next" },
    ];
    const problems = lintGraphStructure(nodes, edges, resolve);
    expect(problems.some((p) => p.message.includes("duplicate edge"))).toBe(true);
  });
});
