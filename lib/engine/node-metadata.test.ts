/**
 * T3 (node-definition refactor, phase 4): engine dispatch routes by def
 * metadata, not literal built-in keys. Two layers under test:
 *
 *  - the catalog contract: exactly one def per SDLC chain role (the first in
 *    graph order being the built-in), the builtinApproval flags, the single
 *    pipeline wait source, the plan resource artifact, and the build def's
 *    fan-out child;
 *  - the engine paths: `keyOfRole` / `gateKey` over the seeded SDLC template,
 *    and the `approveNode` guard built-in approvals now ride the flag.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Must run before any `../db` import touches the connection — dynamic imports
// below execute in statement order after the static ones hoist.
process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-node-metadata-")),
  "test.db",
);

const { db } = await import("../db");
const { FlowEngine } = await import("./flow");
const { nodeRegistry } = await import("./nodes/registry");
const { NODE_KEYS, STEP_BUILD_TEMPLATE_ID } = await import("./nodes/keys");
const { templateStore } = await import("./templates");

const now = () => new Date().toISOString();

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
function must<T>(row: T | undefined, what: string): T {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
}

/** One isolated task + flow on the seeded SDLC template (template_id null). */
function seedFlow(index: number): string {
  const taskId = `task_${index}`;
  const flowId = `flw_${index}`;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId, "generic", `TST-${index}`, "metadata test", "open", "task", "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    flowId, taskId, `metadata test ${index}`, "active", now(), now(),
  );
  return flowId;
}

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

describe("engine chain-role routing (T3)", () => {
  const engine = new FlowEngine();

  it("keyOfRole resolves the flow's node for a chain role through the metadata", () => {
    const flowId = seedFlow(1);
    const expected = templateStore.graphForFlow(flowId)?.nodes
      .find((n) => n.defKey === NODE_KEYS.PLAN)?.key ?? null;
    expect(expected).not.toBeNull(); // the seeded SDLC template has a plan role
    expect(engine.keyOfRole(flowId, NODE_KEYS.PLAN)).toBe(expected);
    expect(engine.keyOfRole(flowId, NODE_KEYS.RESOLVE)).toBe(
      templateStore.graphForFlow(flowId)?.nodes.find((n) => n.defKey === NODE_KEYS.RESOLVE)?.key ?? null,
    );
  });

  it("gateKey resolves the CI gate through the pipeline def's wait source", () => {
    const flowId = seedFlow(2);
    const expected = templateStore.waitNodeKey(flowId, NODE_KEYS.PIPELINE);
    expect(expected).not.toBeNull(); // the seeded SDLC template has a gate
    expect(engine.gateKey(flowId)).toBe(expected);
  });

  it("plan and build approvals belong to their built-in flow actions (the flag, not the key)", () => {
    const flowId = seedFlow(3);
    for (const [nodeKey, type] of [[NODE_KEYS.PLAN, NODE_KEYS.PLAN], [NODE_KEYS.BUILD, NODE_KEYS.BUILD]] as const) {
      db.run(
        `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
        `node_${flowId}_${nodeKey}`, flowId, nodeKey, type, "awaiting_approval", now(), now(),
      );
      expect(() => engine.approveNode(flowId, nodeKey))
        .toThrow(`${nodeKey} approval belongs to its built-in flow actions`);
    }
  });
});
