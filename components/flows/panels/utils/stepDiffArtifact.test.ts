import { describe, expect, it } from "vitest";
import { stepDiffArtifactId } from "./stepDiffArtifact";
import type { Node, PlanStepRow } from "@/types/flow";

const stepOf = (overrides: Partial<PlanStepRow> = {}): PlanStepRow => ({
  id: "ps_1",
  flowId: "flw_parent",
  position: 0,
  title: "Step one",
  files: [],
  status: "done",
  origin: "agent",
  ...overrides,
});

const nodeOf = (overrides: Partial<Node> = {}): Node => ({
  id: "node_1",
  nodeKey: "build",
  type: "build",
  status: "done",
  artifacts: [],
  ...overrides,
});

describe("stepDiffArtifactId", () => {
  it("resolves the aggregate entry's per-step diff artifact id", () => {
    const node = nodeOf({
      output: { steps: [{ id: "OVH-1", status: "done", diff_artifact: "art_step_diff" }] },
    });
    expect(stepDiffArtifactId(node, stepOf({ metaId: "OVH-1" }))).toBe("art_step_diff");
  });

  it("matches on the plan step's id when no meta id exists", () => {
    const node = nodeOf({
      output: { steps: [{ id: "ps_1", status: "done", diff_artifact: "art_step_diff" }] },
    });
    expect(stepDiffArtifactId(node, stepOf())).toBe("art_step_diff");
  });

  it("returns null when the step's aggregate entry carries no per-step diff", () => {
    const node = nodeOf({
      output: { steps: [{ id: "OVH-1", status: "failed" }] },
    });
    expect(stepDiffArtifactId(node, stepOf({ metaId: "OVH-1" }))).toBeNull();
  });

  it("returns null without an aggregate output or for an unaggregated step", () => {
    expect(stepDiffArtifactId(nodeOf(), stepOf({ metaId: "OVH-1" }))).toBeNull();
    const node = nodeOf({ output: { steps: [{ id: "OVH-2", diff_artifact: "art_x" }] } });
    expect(stepDiffArtifactId(node, stepOf({ metaId: "OVH-1" }))).toBeNull();
  });

  it("ignores malformed aggregate entries", () => {
    const node = nodeOf({
      output: { steps: ["not-an-object", { diff_artifact: "art_no_id" }, { id: "OVH-1", diff_artifact: 42 }] },
    });
    expect(stepDiffArtifactId(node, stepOf({ metaId: "OVH-1" }))).toBeNull();
  });
});
