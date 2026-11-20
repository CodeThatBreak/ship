/**
 * The fixed `recover()` ABI (engine overhaul step 05, Invariant 4): every
 * node kind's recover() returns a `{kind:"recovered"} | {kind:"manual",
 * reason}` result and NEVER throws — a contract-violating recorded result is
 * a `manual` recovery with the violation as the reason, and the reconciler
 * pass is crash-safe per node.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { nodeRegistry } = await import("@/lib/engine/nodes/registry");

const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

type NodeRow = import("@/lib/db/rows").NodeRow;

/** A node row recover() reads (resolved through the engine's own graph). */
const nodeRowOf = async (flowId: string, nodeKey: string): Promise<NodeRow> => {
  const row = await db.get<Record<string, unknown>>(
    `SELECT * FROM nodes WHERE flow_id=$1 AND node_key=$2`,
    flowId, nodeKey,
  );
  if (!row) throw new Error(`no node row for ${flowId}/${nodeKey}`);
  return row as NodeRow;
};

/** Resolve the def for one of the flow's nodes through the engine's registry. */
const defOfNode = async (flowId: string, nodeKey: string) => {
  const graph = await harness.graphForFlow(flowId);
  const spec = graph?.byKey.get(nodeKey);
  if (!spec) throw new Error(`no graph node ${nodeKey} on ${flowId}`);
  return nodeRegistry.resolve(spec.defKey, nodeKey);
};

describe("recover() never throws out of the reconciler", () => {
  test("agent recover() with a contract-violating recorded result resolves to manual", async () => {
    // a declarative json-output agent node (its contract the recover re-parse enforces)
    const flowId = await harness.seedInlineFlow(
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
    const ctx = await flowEngine.ctx(flowId);
    const node = await nodeRowOf(flowId, "triage");
    const def = await defOfNode(flowId, "triage");
    // a finished result whose text violates the agent's JSON output contract —
    // a `manual` recovery with the violation as the reason, never a throw
    await expect(
      def.recover(ctx, node, { status: "finished", result: "not json at all" }, "reconcile"),
    ).resolves.toMatchObject({ kind: "manual", reason: expect.stringContaining("no JSON") });
  });

  test("decision recover() with a malformed recorded result resolves to manual", async () => {
    const flowId = await harness.seedInlineFlow(
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
        { key: "fix_path", def: "nt_st_write_doc", config: { runtime: "shell", script: "echo '{}'" } },
        { key: "ship_path", def: "nt_st_write_doc", config: { runtime: "shell", script: "echo '{}'" } },
      ],
      [
        { from: "pick", to: "fix_path", label: "fix" },
        { from: "pick", to: "ship_path", label: "ship" },
      ],
    );
    const ctx = await flowEngine.ctx(flowId);
    const node = await nodeRowOf(flowId, "pick");
    const def = await defOfNode(flowId, "pick");
    await expect(
      def.recover(ctx, node, { status: "finished", result: "totally unparseable" }, "reconcile"),
    ).resolves.toMatchObject({ kind: "manual", reason: expect.any(String) });
  });

  test("review recover() resolves to the fixed ABI result (never a throw)", async () => {
    const flowId = await harness.seedSdlcFlow();
    const ctx = await flowEngine.ctx(flowId);
    const node = await nodeRowOf(flowId, "review");
    const def = await defOfNode(flowId, "review");
    // the ledger-backed recovery path re-runs the posting — whatever the
    // recorded state holds, the ABI result comes back (never a throw)
    await expect(
      def.recover(ctx, node, { status: "finished", result: "[]" }, "reconcile"),
    ).resolves.toMatchObject({ kind: expect.any(String) });
  });
});
