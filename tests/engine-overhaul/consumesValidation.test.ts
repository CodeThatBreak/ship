/**
 * Flip (green, step 04): a node whose materialized stage-start input misses a
 * declared upstream field fails with a typed `input_contract_violation`
 * naming the field and the producing node — the stage refuses to proceed
 * (engine overhaul step 00 placeholder → step 04 implementation).
 *
 * The scenario is the docs-generation shape: a script node's `input_map`
 * promises `doc` from the upstream summarize agent's `markdown` output. The
 * upstream never ran (no output) — today the mapping silently vanished and
 * the script ran on an empty input; now the stage fails typed instead.
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

const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

describe("consumes validation at stage start", () => {
  test("missing input_map target ⇒ failed with a typed event naming the field and the producer", async () => {
    const flowId = await harness.seedInlineFlow(
      [
        { key: "summarize", def: "nt_st_summarize" },
        {
          key: "write_doc",
          def: "nt_st_write_doc",
          input_map: { doc: "nodes.summarize.output.markdown" },
        },
      ],
      [{ from: "summarize", to: "write_doc" }],
    );

    await harness.runStage(flowId, "write_doc");

    expect(await harness.nodeStatus(flowId, "write_doc")).toBe("failed");
    const events = await harness.events(flowId, { nodeKey: "write_doc" });
    const violation = events.find((e) => e.type === "input_contract_violation");
    expect(violation).toBeDefined();
    expect(violation?.message).toContain('"doc"');
    expect(violation?.message).toContain("summarize");
    // the producing node was never started — the stage refused at the consumer
    expect(await harness.nodeStatus(flowId, "summarize")).toBe("pending");
  });

  test("a satisfied input_map target does not refuse the stage (the failure is the node's own)", async () => {
    const flowId = await harness.seedInlineFlow(
      [
        { key: "summarize", def: "nt_st_summarize" },
        {
          key: "write_doc",
          def: "nt_st_write_doc",
          input_map: { doc: "nodes.summarize.output.markdown" },
        },
      ],
      [{ from: "summarize", to: "write_doc" }],
    );
    // fixture setup: the upstream finished and published the mapped field
    await harness.setNodeOutputForFixture(flowId, "summarize", "done", { markdown: "hello" });

    await harness.runStage(flowId, "write_doc");

    const events = await harness.events(flowId, { nodeKey: "write_doc" });
    expect(events.some((e) => e.type === "input_contract_violation")).toBe(false);
    // the stage proceeded past the contract seam — whatever failure follows is
    // the script's own environment failure, not a contract refusal
    expect(await harness.nodeStatus(flowId, "write_doc")).toBe("failed");
  });
});
