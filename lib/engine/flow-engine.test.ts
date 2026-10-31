/**
 * T3 (node-definition refactor, phase 4): engine dispatch routes by def
 * metadata, not literal built-in keys. Covered here: the engine paths —
 * `keyOfRole` / `gateKey` over the seeded SDLC template, and the `approveNode`
 * guard built-in approvals now ride the flag (the registry-side catalog
 * contract lives in `nodes/registry.test.ts`).
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
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-flow-engine-")),
  "test.db",
);

const { db } = await import("../db");
const { FlowEngine } = await import("./flow-engine");
const { ERROR_CODE } = await import("../errors");
const { NODE_KEYS } = await import("./constants/node-keys");
const { templateStore } = await import("./templates/template-store");

const now = () => new Date().toISOString();

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

  it("delete throws NotFoundError when the flow id is missing", async () => {
    await expect(engine.delete("flw_missing")).rejects.toMatchObject({
      status: 404,
      code: ERROR_CODE.NOT_FOUND,
      message: "flow flw_missing not found",
    });
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
