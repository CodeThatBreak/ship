import { describe, expect, it } from "vitest";
import {
  resolveCockpitSelectedKey,
  runningNodeKeysOf,
} from "@/components/flows/cockpit/utils/resolveCockpitSelection";
import {
  effectiveDecisionSelection,
  isSameDecisionPick,
  toggleDecisionLabel,
} from "@/components/flows/panels/utils/decisionSelection";
import { formatCostCents } from "@/components/flows/panels/utils/costFormat";
import { resolveClockLabel } from "@/components/flows/panels/utils/resolveClockLabel";
import type { Node } from "@/types/flow";

const node = (key: string, status: string): Node => ({
  id: `id_${key}`,
  nodeKey: key,
  type: key,
  status,
  artifacts: [],
});

describe("resolveCockpitSelectedKey", () => {
  it("follows the first running node (graph order) until the user selects a node", () => {
    const nodes = [node("plan", "done"), node("build", "running"), node("review", "running")];
    expect(resolveCockpitSelectedKey("", nodes)).toBe("build");
    expect(resolveCockpitSelectedKey("plan", nodes)).toBe("plan");
    expect(resolveCockpitSelectedKey("", [node("plan", "done")])).toBe("");
  });
});

describe("runningNodeKeysOf", () => {
  it("collects every running node key — fan-out may run several at once", () => {
    const nodes = [node("plan", "done"), node("build", "running"), node("review", "running")];
    expect(runningNodeKeysOf(nodes)).toEqual(new Set(["build", "review"]));
  });

  it("is empty for an idle flow (no running nodes)", () => {
    expect(runningNodeKeysOf([node("plan", "awaiting_approval")])).toEqual(new Set());
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
