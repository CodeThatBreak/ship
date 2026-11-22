import { describe, expect, it } from "vitest";
import { isAgenticNode } from "@/components/flows/panels/utils/isAgenticNode";
import type { Node } from "@/types/flow";

const nodeOf = (capabilities: Node["capabilities"]): Node => ({
  id: "node_1",
  nodeKey: "agent",
  type: "agent",
  status: "running",
  artifacts: [],
  capabilities,
});

describe("isAgenticNode", () => {
  it("is true when the node publishes the refinable capability", () => {
    expect(isAgenticNode(nodeOf({ refinable: true }))).toBe(true);
  });

  it("is false without capabilities", () => {
    expect(isAgenticNode(nodeOf(undefined))).toBe(false);
    expect(isAgenticNode(nodeOf(null))).toBe(false);
  });

  it("is false when capabilities exist but the node is not refinable", () => {
    expect(isAgenticNode(nodeOf({ refinable: false }))).toBe(false);
    expect(isAgenticNode(nodeOf({ panelTitle: "Build bot" }))).toBe(false);
  });
});
