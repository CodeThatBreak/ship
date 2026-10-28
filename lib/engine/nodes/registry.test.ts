/**
 * T3 (node-definition refactor, phase 4): the catalog contract — exactly one
 * def per SDLC chain role (the first in graph order being the built-in), the
 * builtinApproval flags, the single pipeline wait source, the plan resource
 * artifact, and the build def's fan-out child.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Must run before any `db` import touches the connection — dynamic imports
// below execute in statement order after the static ones hoist.
process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-node-registry-")),
  "test.db",
);

const { nodeRegistry } = await import("./registry");
const { NODE_KEYS, STEP_BUILD_TEMPLATE_ID } = await import("../constants/node-keys");

describe("NodeDefinition engine-dispatch metadata (T3)", () => {
  it("the first def holding each SDLC chain role is the built-in kind", () => {
    const roles = {
      [NODE_KEYS.PLAN]: NODE_KEYS.PLAN,
      [NODE_KEYS.BUILD]: NODE_KEYS.BUILD,
      [NODE_KEYS.REVIEW]: NODE_KEYS.REVIEW,
      [NODE_KEYS.RESOLVE]: NODE_KEYS.RESOLVE,
    } as const;
    for (const [role, expectedKey] of Object.entries(roles)) {
      const def = nodeRegistry.all().find((d) => d.chainRole === role);
      expect(def?.key, `chain role ${role}`).toBe(expectedKey);
    }
  });

  it("plan and build own their approvals; every other def defers to the generic approveNode", () => {
    expect(nodeRegistry.get(NODE_KEYS.PLAN).builtinApproval).toBe(true);
    expect(nodeRegistry.get(NODE_KEYS.BUILD).builtinApproval).toBe(true);
    expect(nodeRegistry.get(NODE_KEYS.REVIEW).builtinApproval).toBe(false);
    expect(nodeRegistry.get(NODE_KEYS.RESOLVE).builtinApproval).toBe(false);
    expect(nodeRegistry.get(NODE_KEYS.PIPELINE).builtinApproval).toBe(false);
  });

  it("the pipeline kind is the single wait source the CI gate waits on", () => {
    const sources = nodeRegistry.all().filter((d) => d.waitForKind);
    expect(sources.map((d) => d.key)).toEqual([NODE_KEYS.PIPELINE]);
    expect(sources[0]?.waitForKind).toBe(NODE_KEYS.PIPELINE);
  });

  it("the plan kind publishes the plan artifact as its first-class resource", () => {
    expect([...nodeRegistry.get(NODE_KEYS.PLAN).resourceArtifacts]).toEqual([NODE_KEYS.PLAN]);
  });

  it("the build def's fan-out fallback is the seeded step build; other defs auto-wrap", () => {
    expect(nodeRegistry.get(NODE_KEYS.BUILD).childTemplateId()).toBe(STEP_BUILD_TEMPLATE_ID);
    expect(nodeRegistry.get(NODE_KEYS.PLAN).childTemplateId()).toBeNull();
    expect(nodeRegistry.get(NODE_KEYS.REVIEW).childTemplateId()).toBeNull();
    expect(nodeRegistry.get(NODE_KEYS.RESOLVE).childTemplateId()).toBeNull();
    expect(nodeRegistry.get(NODE_KEYS.PIPELINE).childTemplateId()).toBeNull();
  });
});
