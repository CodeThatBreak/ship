import { describe, expect, it } from "vitest";
import { resolveCockpitSelectedKey } from "@/components/flows/cockpit/utils/resolveCockpitSelection";
import {
  effectiveDecisionSelection,
  isSameDecisionPick,
  toggleDecisionLabel,
} from "@/components/flows/panels/utils/decisionSelection";
import { formatCostCents } from "@/components/flows/panels/utils/costFormat";
import { resolveClockLabel } from "@/components/flows/panels/utils/resolveClockLabel";

describe("resolveCockpitSelectedKey", () => {
  it("follows current_node until the user selects a node", () => {
    expect(resolveCockpitSelectedKey("", "node_b")).toBe("node_b");
    expect(resolveCockpitSelectedKey("node_a", "node_b")).toBe("node_a");
    expect(resolveCockpitSelectedKey("", null)).toBe("");
  });
});

describe("decision selection", () => {
  it("derives the pick from proposed until the user overrides", () => {
    expect(effectiveDecisionSelection(null, [])).toEqual([]);
    expect(effectiveDecisionSelection(null, ["main"])).toEqual(["main"]);
    expect(effectiveDecisionSelection(["hotfix"], ["main"])).toEqual(["hotfix"]);
  });

  it("tracks when the effective pick matches the proposal", () => {
    expect(isSameDecisionPick(["a"], ["a"])).toBe(true);
    expect(isSameDecisionPick(["b"], ["a"])).toBe(false);
  });

  it("toggles labels on a working set", () => {
    expect(toggleDecisionLabel(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleDecisionLabel(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("formatCostCents", () => {
  it("formats sub-cent runs as dollars, not 100× inflated", () => {
    expect(formatCostCents(0.4)).toBe("$0.0040");
    expect(formatCostCents(1)).toBe("$0.01");
    expect(formatCostCents(150)).toBe("$1.50");
  });
});

describe("resolveClockLabel", () => {
  it("returns null when no schedule exists", () => {
    expect(resolveClockLabel(null, 1_000)).toBeNull();
  });

  it("returns a time label before the schedule fires", () => {
    const at = 10_000_000;
    const label = resolveClockLabel(at, 0);
    expect(label).toBeTypeOf("string");
    expect(label).not.toBe("pipeline-gated");
  });

  it("signals pipeline gating after the quiet period", () => {
    expect(resolveClockLabel(1_000, 2_000)).toBe("pipeline-gated");
  });
});
