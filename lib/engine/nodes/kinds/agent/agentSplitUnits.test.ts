/**
 * Unit tests for the agent kind's split-source mapping (`agentSplitUnits`) —
 * the pure part of `AgentTemplateNode.splitUnits` (agent-node split plan
 * §2.1, Phase 3). The node-level integration path (raw output blob decode,
 * the null-when-no-output cases, the directive bytes) stays covered in
 * `agentTemplateNode.test.ts`; here the unit-shape contract is pinned
 * directly: mapping rules, the loud producer-error policy, no silent skips.
 */
import { describe, expect, it } from "vitest";
import { AgentOutputError } from "../../shared/agent/outputError/outputErrorExports";
import type { AgentDef } from "../../schemas/declarativeSchemas";
import { agentSplitUnits } from "./agentSplitUnits";

const LABEL = "Test Agent";

/** The split selectors on non-default item paths (defaults are key / dependsOn). */
const SPLIT: NonNullable<AgentDef["split"]> = {
  field: "services",
  key_field: "id",
  target: "build",
  target_field: "route",
  depends_on_field: "after",
};

const UNITS = [
  { id: "api", title: "API service", after: ["db"], route: "nt_docs" },
  { id: "db" },
];

/** splitUnits rejects with the producer error — capture it; a clean
 *  (non-throwing) return is itself the failure. */
function unitsErrorOf(fn: () => unknown): AgentOutputError {
  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof AgentOutputError) return e;
    throw new Error(`expected an AgentOutputError, got ${String(e)}`);
  }
  throw new Error("expected splitUnits to fail loudly");
}

describe("agentSplitUnits", () => {
  it("maps key/title/dependsOn/target selectors, with the per-item target override", () => {
    const units = agentSplitUnits(SPLIT, { services: UNITS }, LABEL);
    expect(units).toHaveLength(2);
    // selectors on non-default paths; the item rides verbatim
    expect(units?.[0]).toEqual({
      key: "api",
      title: "API service",
      dependsOn: ["db"],
      target: "nt_docs", // per-item override beats the split default target
      item: UNITS[0],
    });
    // no title field → the key is the title; no deps → []; no override → the default target
    expect(units?.[1]).toEqual({
      key: "db",
      title: "db",
      dependsOn: [],
      target: "build",
      item: UNITS[1],
    });
  });

  it("no array at the field, or an empty array → null (no expansion)", () => {
    expect(agentSplitUnits(SPLIT, {}, LABEL)).toBeNull();
    expect(agentSplitUnits(SPLIT, { services: [] }, LABEL)).toBeNull();
  });

  it("a non-array at the field fails loudly — the producer-error policy", () => {
    const error = unitsErrorOf(() => agentSplitUnits(SPLIT, { services: "oops" }, LABEL));
    expect(error.code).toBe("schema_mismatch");
    expect(error.detail.label).toBe(LABEL);
    expect(error.detail.message).toBe(`${LABEL}: split field "services" must be an array of unit items (got string)`);
    expect(error.detail.response_excerpt).toBe(JSON.stringify("oops"));
  });

  it("an item that is not an object fails loudly", () => {
    const error = unitsErrorOf(() => agentSplitUnits(SPLIT, { services: [1] }, LABEL));
    expect(error.code).toBe("schema_mismatch");
    expect(error.detail.message).toBe(`${LABEL}: split field "services" item 0 is not an object`);
  });

  it("a missing or blank unit key fails loudly — never a silent skip", () => {
    const error = unitsErrorOf(() =>
      agentSplitUnits(SPLIT, { services: [{ title: "no id" }] }, LABEL),
    );
    expect(error.code).toBe("schema_mismatch");
    expect(error.detail.message).toBe(
      `${LABEL}: item 0 has no usable "id" — every unit needs a stable, non-empty key`,
    );
    const blank = unitsErrorOf(() => agentSplitUnits(SPLIT, { services: [{ id: "  " }] }, LABEL));
    expect(blank.code).toBe("schema_mismatch");
  });

  it("non-string[] dependencies fail loudly", () => {
    const notArray = unitsErrorOf(() =>
      agentSplitUnits(SPLIT, { services: [{ id: "api", after: "db" }] }, LABEL),
    );
    expect(notArray.code).toBe("schema_mismatch");
    expect(notArray.detail.message).toBe(`${LABEL}: item 0's "after" must be an array of unit keys`);
    const notStrings = unitsErrorOf(() =>
      agentSplitUnits(SPLIT, { services: [{ id: "api", after: ["db", 2] }] }, LABEL),
    );
    expect(notStrings.code).toBe("schema_mismatch");
    expect(notStrings.detail.message).toBe(`${LABEL}: item 0's "after" must be an array of unit keys`);
  });

  it("a split without a target_field override falls back to the split default", () => {
    const noTargetField: NonNullable<AgentDef["split"]> = {
      field: "services",
      key_field: "id",
      target: "build",
      depends_on_field: "after",
    };
    const units = agentSplitUnits(noTargetField, { services: [{ id: "api", route: "nt_docs" }] }, LABEL);
    expect(units?.[0]).toMatchObject({ key: "api", target: "build" });
  });
});
