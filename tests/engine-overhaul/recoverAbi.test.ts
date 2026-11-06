/**
 * Characterization (red): `recover()` must NEVER throw out of the reconciler,
 * for every node kind (engine overhaul step 00; flip in step 05).
 *
 * Current bugs (a recover() throw escapes the reconciler's per-node guard as a
 * reconcile `error` event instead of a `manual` recovery outcome):
 *  - agent (`agentNode.ts:398-403`): re-parses the recorded output with NO
 *    try/catch — a contract-violating recorded result throws.
 *  - decision (`decisionNode.ts:230-232`): re-parses the agent pick the same
 *    way — a malformed recorded result throws.
 *  - review (`reviewNode.ts:309-311`) and the other always-false kinds:
 *    recover() just returns false — safe today, pinned so the step-05 ABI
 *    ({kind:"manual"} instead of false) keeps them non-throwing.
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import { describe, expect, test } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-recover-abi-"));

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { nodeRegistry } = await import("@/lib/engine/nodes/registry");

const harness = new FlowHarness({ db, flowEngine, templateStore });

type NodeRow = import("@/lib/db/rows").NodeRow;

/** A node row recover() reads (resolved through the engine's own graph). */
const nodeRowOf = (flowId: string, nodeKey: string): NodeRow => {
  const row = db.get<Record<string, unknown>>(
    `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`,
    flowId, nodeKey,
  );
  if (!row) throw new Error(`no node row for ${flowId}/${nodeKey}`);
  return row as NodeRow;
};

/** Resolve the def for one of the flow's nodes through the engine's registry. */
const defOfNode = (flowId: string, nodeKey: string) => {
  const spec = harness.graphForFlow(flowId)?.byKey.get(nodeKey);
  if (!spec) throw new Error(`no graph node ${nodeKey} on ${flowId}`);
  return nodeRegistry.resolve(spec.defKey, nodeKey);
};

describe("recover() never throws out of the reconciler", () => {
  // OVERHAUL: flip in step 05
  test.fails("agent recover() with a contract-violating recorded result resolves, never throws", async () => {
    // a declarative json-output agent node (its contract the recover re-parse enforces)
    const flowId = harness.seedInlineFlow(
      [
        {
          key: "triage",
          def: "nt_st_triage",
          config: {
            mode: "plan",
            output: "json",
            prompt: "triage",
            output_schema: {
              type: "object",
              required: ["severity"],
              properties: { severity: { type: "string" } },
            },
          },
        },
      ],
      [],
    );
    const ctx = flowEngine.ctx(flowId);
    const node = nodeRowOf(flowId, "triage");
    const def = defOfNode(flowId, "triage");
    // a finished result whose text violates the agent's JSON output contract
    await expect(
      def.recover(ctx, node, { status: "finished", result: "not json at all" }, "reconcile"),
    ).resolves.not.toThrow();
  });

  // OVERHAUL: flip in step 05
  test.fails("decision recover() with a malformed recorded result resolves, never throws", async () => {
    const flowId = harness.seedInlineFlow(
      [
        {
          key: "pick",
          def: "nt_st_ship_decision",
          config: {
            source: "agent",
            question: "pick one",
            choices: [{ label: "fix" }, { label: "ship" }],
          },
        },
      ],
      [],
    );
    const ctx = flowEngine.ctx(flowId);
    const node = nodeRowOf(flowId, "pick");
    const def = defOfNode(flowId, "pick");
    await expect(
      def.recover(ctx, node, { status: "finished", result: "totally unparseable" }, "reconcile"),
    ).resolves.not.toThrow();
  });

  // OVERHAUL: flip in step 05 (already safe today — pinned for the ABI change)
  test("review recover() returns false (not a throw) — the always-false kinds stay safe", async () => {
    const flowId = harness.seedSdlcFlow();
    const ctx = flowEngine.ctx(flowId);
    const node = nodeRowOf(flowId, "review");
    const def = defOfNode(flowId, "review");
    await expect(
      def.recover(ctx, node, { status: "finished", result: "[]" }, "reconcile"),
    ).resolves.toBe(false);
  });
});
