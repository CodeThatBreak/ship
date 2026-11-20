/**
 * Edge conditions (green — engine overhaul step 04): a template whose edge or
 * loop condition references a nonexistent output key must be REJECTED by lint
 * / the validate route, and a condition whose references sit inside the
 * producing node's declared contract saves cleanly.
 *
 * Raw JSONata conditions carry no `{{...}}` wrappers, so the linter walks the
 * compiled AST for `nodes.<key>.output.<field>` paths and checks them against
 * the same contract map the template refs use (same wildcard / free-form
 * free-passes — builtin loop conditions like the SDLC's
 * `nodes.resolve.output.pushed = true` stay valid).
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
  test("an edge condition referencing a nonexistent output key is rejected", async () => {
    // the seeded triage agent publishes {severity, summary, suggested_fix};
    // the loop condition references a field outside that contract —
    // save/import rejects the template
    const badTemplate = {
      name: "ovh bad edge condition",
      trigger: { type: "manual", task_type: "jira" },
      nodes: [
        { key: "triage", nodeTemplateId: "nt_st_triage", trigger: { type: "auto" } },
        { key: "resolve", nodeTemplateId: "nt_resolve", trigger: { type: "debounced" } },
      ],
      edges: [
        {
          from: "triage",
          to: "resolve",
          kind: "loop" as const,
          condition: "nodes.triage.output.doesNotExist = true",
        },
      ],
    };

    await expect(templateStore.create(badTemplate)).rejects.toThrow(/doesNotExist|output|edge/i);
  });

  test("an edge condition inside the producing node's contract saves cleanly", async () => {
    const goodTemplate = {
      name: "ovh good edge condition",
      trigger: { type: "manual", task_type: "jira" },
      nodes: [
        {
          key: "builder",
          nodeTemplateId: "nt_st_summarize",
          trigger: { type: "auto" },
          config: {
            output: "json",
            output_schema: { type: "object", properties: { pushed: { type: "boolean" } } },
          },
        },
        { key: "pipeline", nodeTemplateId: "nt_pipeline", trigger: { type: "auto", wait_for: "pipeline" } },
      ],
      edges: [
        { from: "builder", to: "pipeline", kind: "next" as const, label: null, condition: null },
        {
          from: "pipeline",
          to: "builder",
          kind: "loop" as const,
          label: null,
          condition: "nodes.builder.output.pushed = true",
        },
      ],
    };

    await expect(templateStore.create(goodTemplate)).resolves.toMatch(/^tpl_/);
  });
});
