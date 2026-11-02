import { describe, expect, it } from "vitest";
import { isNodeKind, NODE_KIND } from "@/constants/nodeKind";

describe("node-kind constants", () => {
  it("recognizes declarative kinds", () => {
    expect(isNodeKind(NODE_KIND.AGENT)).toBe(true);
    expect(isNodeKind("unknown")).toBe(false);
  });
});
