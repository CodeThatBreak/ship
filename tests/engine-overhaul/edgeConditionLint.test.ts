/**
 * Characterization (red): a template whose edge condition references a
 * nonexistent output key must be REJECTED by lint / the validate route
 * (engine overhaul step 00; flip in step 04).
 *
 * Current gap (`templateLint.ts:397-403`): edge + loop conditions are only
 * checked for JSONata syntax — a condition like
 * `nodes.build.output.doesNotExist = true` compiles fine, so the bad
 * reference sails through save/validate and only misbehaves at run time.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";

assignTestDatabase();

const { templateStore } = await import("@/lib/engine/templates/templateStore");

beforeAll(resetTestDatabase);

describe("edge condition output-key lint", () => {
  // OVERHAUL: flip in step 04
  test.fails("an edge condition referencing a nonexistent output key is rejected", async () => {
    // resolve publishes a fixed contract; the loop condition references a field
    // that is not in it — target: save/import rejects the template
    const badTemplate = {
      name: "ovh bad edge condition",
      trigger: { type: "manual", task_type: "jira" },
      nodes: [
        { key: "pipeline", nodeTemplateId: "nt_pipeline", trigger: { type: "auto" } },
        { key: "resolve", nodeTemplateId: "nt_resolve", trigger: { type: "debounced" } },
      ],
      edges: [
        {
          from: "resolve",
          to: "pipeline",
          kind: "loop" as const,
          condition: "nodes.resolve.output.doesNotExist = true",
        },
      ],
    };

    await expect(templateStore.create(badTemplate)).rejects.toThrow(/doesNotExist|output|edge/i);
  });
});
