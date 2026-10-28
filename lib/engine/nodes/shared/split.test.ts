/**
 * Agent-node split plan, Phase 1 — contract tests (§7 item 1): target
 * resolution (node key / template id / ambiguity / unknown), the template
 * start-contract compatibility check, unit-DAG cycle detection, the
 * `split_consume` knob's defensive read, and the `AgentDefSchema.split`
 * declaration. Nothing here is wired into a runtime path yet.
 *
 * The `flowSplitTargetLookup` adapter needs the real singletons, so the
 * suite runs against an isolated temp SQLite DB: DATABASE_PATH is read
 * lazily by lib/config.ts, so setting it before the first `db` import
 * isolates the singleton (AGENTS.md §1 — never a real database).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Must run before any `db` import touches the connection — dynamic imports
// below execute in statement order after the static ones hoist.
process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-split-contracts-")),
  "test.db",
);

import {
  DEFAULT_SPLIT_CONSUME,
  SPLIT_CONSUME_MODES,
  SplitTargetError,
  UnitCycleError,
  assertSplitTargetCompatible,
  detectUnitCycle,
  resolveSplitTarget,
  splitConsumeOf,
  type SplitTargetLookup,
  type SplitUnit,
} from "./split";
import type { StartContractField } from "../kinds/start/contract";

const { templateStore } = await import("../../templates/template-store");
const { flowSplitTargetLookup } = await import("./split-lookup");
const { AgentDefSchema } = await import("../declarative-schemas");

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
function must<T>(row: T | undefined, what: string): T {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
}

const unit = (key: string, dependsOn: string[] = []): SplitUnit => ({
  key,
  title: key,
  dependsOn,
  item: { key },
});

describe("resolveSplitTarget", () => {
  const nodeOnly: SplitTargetLookup = {
    isNodeKey: (k) => k === "build",
    template: () => null,
  };
  const templateOnly: SplitTargetLookup = {
    isNodeKey: () => false,
    template: (k) => (k === "nt_docs" || k === "docs" ? { id: "nt_docs" } : null),
  };

  it("resolves a node key to a node target", () => {
    expect(resolveSplitTarget("build", nodeOnly)).toEqual({ kind: "node", key: "build" });
  });

  it("resolves a template id (and catalog key) to a template target with the row id", () => {
    expect(resolveSplitTarget("nt_docs", templateOnly)).toEqual({ kind: "template", id: "nt_docs" });
    expect(resolveSplitTarget("docs", templateOnly)).toEqual({ kind: "template", id: "nt_docs" });
  });

  it("throws the typed error when a target matches both registries (ambiguity)", () => {
    const both: SplitTargetLookup = {
      isNodeKey: (k) => k === "build",
      template: (k) => (k === "build" ? { id: "nt_build" } : null),
    };
    expect(() => resolveSplitTarget("build", both)).toThrow(SplitTargetError);
    expect(() => resolveSplitTarget("build", both)).toThrow(/ambiguous/);
  });

  it("throws the typed error for an unknown target", () => {
    expect(() => resolveSplitTarget("nope", nodeOnly)).toThrow(SplitTargetError);
    expect(() => resolveSplitTarget("nope", nodeOnly)).toThrow(/unknown split target/);
  });

  it("resolves against the real singletons: builtin key → node, created template row → template", () => {
    expect(resolveSplitTarget("build", flowSplitTargetLookup)).toEqual({ kind: "node", key: "build" });
    const row = templateStore.createNodeTemplate({
      key: "docs_writer",
      name: "Docs Writer",
      kind: "agent",
      config: {},
    });
    expect(resolveSplitTarget(must(row, "created node template").id, flowSplitTargetLookup))
      .toEqual({ kind: "template", id: row.id });
    expect(resolveSplitTarget("docs_writer", flowSplitTargetLookup))
      .toEqual({ kind: "template", id: row.id });
    expect(flowSplitTargetLookup.template("nt_missing")).toBeNull();
  });
});

describe("assertSplitTargetCompatible", () => {
  const fields: StartContractField[] = [
    { key: "service", label: "Service", type: "string", required: true },
    { key: "region", type: "string", required: false },
  ];

  it("accepts a template item matching the start contract", () => {
    expect(() =>
      assertSplitTargetCompatible({ kind: "template", id: "nt_docs" }, { service: "api" }, fields),
    ).not.toThrow();
  });

  it("rejects a template item missing a required contract field", () => {
    expect(() =>
      assertSplitTargetCompatible({ kind: "template", id: "nt_docs" }, {}, fields),
    ).toThrow(SplitTargetError);
  });

  it("rejects a template item carrying fields outside the contract (strict shape)", () => {
    expect(() =>
      assertSplitTargetCompatible(
        { kind: "template", id: "nt_docs" },
        { service: "api", extra: 1 },
        fields,
      ),
    ).toThrow(SplitTargetError);
  });

  it("is a no-op when the template declares no contract fields", () => {
    expect(() =>
      assertSplitTargetCompatible({ kind: "template", id: "nt_docs" }, { anything: true }, []),
    ).not.toThrow();
  });

  it("is a no-op for node targets in Phase 1 (the split_consume knob wires in Phase 4)", () => {
    expect(() =>
      assertSplitTargetCompatible({ kind: "node", key: "build" }, {}, fields),
    ).not.toThrow();
  });
});

describe("detectUnitCycle", () => {
  it("accepts an acyclic DAG, including diamond dependencies", () => {
    expect(detectUnitCycle([unit("a"), unit("b", ["a"]), unit("c", ["a"]), unit("d", ["b", "c"])]))
      .toBeNull();
  });

  it("accepts independent units and empty input", () => {
    expect(detectUnitCycle([unit("a"), unit("b")])).toBeNull();
    expect(detectUnitCycle([])).toBeNull();
  });

  it("reports a dependency cycle as the closed walk", () => {
    const cycle = detectUnitCycle([unit("a", ["b"]), unit("b", ["c"]), unit("c", ["a"])]);
    expect(cycle).toEqual(["a", "b", "c", "a"]);
  });

  it("reports a self-dependency", () => {
    expect(detectUnitCycle([unit("a", ["a"])])).toEqual(["a", "a"]);
  });

  it("finds the cycle regardless of where the scan starts", () => {
    const units = [unit("z"), unit("a", ["b"]), unit("b", ["a"])];
    expect(detectUnitCycle(units)).toEqual(["a", "b", "a"]);
  });

  it("ignores dependencies on unknown unit keys (scheduling owns unresolvable deps)", () => {
    expect(detectUnitCycle([unit("a", ["ghost"])])).toBeNull();
  });

  it("exposes the path on the typed error for loud producers", () => {
    const err = new UnitCycleError(["a", "a"]);
    expect(err).toBeInstanceOf(Error);
    expect(err.path).toEqual(["a", "a"]);
    expect(err.message).toContain("a → a");
  });
});

describe("splitConsumeOf", () => {
  it("defaults to whole for absent, null and empty configs", () => {
    expect(splitConsumeOf(undefined)).toBe(DEFAULT_SPLIT_CONSUME);
    expect(splitConsumeOf(null)).toBe(DEFAULT_SPLIT_CONSUME);
    expect(splitConsumeOf({})).toBe(DEFAULT_SPLIT_CONSUME);
  });

  it("reads every declared mode from the flat split_consume key", () => {
    for (const mode of SPLIT_CONSUME_MODES) {
      expect(splitConsumeOf({ split_consume: mode })).toBe(mode);
    }
  });

  it("bows out to whole on unknown or non-string values (never throws a run down)", () => {
    expect(splitConsumeOf({ split_consume: "per_unit" })).toBe(DEFAULT_SPLIT_CONSUME);
    expect(splitConsumeOf({ split_consume: 42 })).toBe(DEFAULT_SPLIT_CONSUME);
    expect(splitConsumeOf({ split_consume: null })).toBe(DEFAULT_SPLIT_CONSUME);
  });
});

describe("AgentDefSchema.split", () => {
  it("parses without split — the node is not a source", () => {
    const def = AgentDefSchema.parse({});
    expect(def.split).toBeUndefined();
  });

  it("fills the defaults inside a declared split", () => {
    const def = AgentDefSchema.parse({ split: { field: "services" } });
    expect(def.split).toEqual({
      field: "services",
      key_field: "key",
      depends_on_field: "dependsOn",
    });
    expect(def.split).not.toHaveProperty("target");
    expect(def.split).not.toHaveProperty("target_field");
  });

  it("requires the field to iterate", () => {
    expect(() => AgentDefSchema.parse({ split: {} })).toThrow();
  });

  it("keeps the looseObject tolerance for unknown keys", () => {
    const def = AgentDefSchema.parse({ future_knob: 1, split: { field: "items", target: "build" } });
    expect(must(def.split, "split config").target).toBe("build");
  });

  it("rejects a blank split.field (parseDeclarativeConfig surfaces it at save)", () => {
    expect(() => AgentDefSchema.parse({ split: { field: "" } })).toThrow(/split.field is required/);
  });
});

// ── Phase 3: the split knobs' authoring-time lint (template save/import) ─────

const { lintTemplate } = await import("../../templates/template-lint");

/** One agent node whose def config rides the catalog entry (no instance
 *  overrides) — the split lint reads the merged config. */
function lintAgentSplit(config: Record<string, unknown>) {
  return lintTemplate(
    [{ key: "src", nodeTemplateId: "nt_src", inputMap: {}, config: {} }],
    [],
    { nt_src: { kind: "agent", config, key: "nt_src", isBuiltin: false } },
  );
}

/** The output schema of the canonical unit source: services[] with id/title. */
const SPLIT_SOURCE_SCHEMA = {
  type: "object",
  properties: {
    services: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } } } },
  },
  required: ["services"],
};

describe("template-lint — agent split rules", () => {
  const VALID = {
    output: "json",
    output_schema: SPLIT_SOURCE_SCHEMA,
    split: { field: "services", key_field: "id", depends_on_field: "title" },
  };

  it("a well-formed split lints clean", () => {
    expect(lintAgentSplit(VALID).error).toBeNull();
  });

  it("split on a markdown agent is flagged (no array to iterate)", () => {
    const lint = lintAgentSplit({ ...VALID, output_schema: null, split: { field: "services" }, output: "markdown" });
    expect(lint.problems.some((p) => /set output to json/.test(p.message))).toBe(true);
  });

  it("a blank or undeclared split.field is flagged", () => {
    const blank = lintAgentSplit({ ...VALID, split: { key_field: "id" } });
    expect(blank.problems.some((p) => /split.field is required/.test(p.message))).toBe(true);
    const missing = lintAgentSplit({ ...VALID, split: { ...VALID.split, field: "nope" } });
    expect(missing.problems.some((p) => /"nope" is not declared in the output schema/.test(p.message))).toBe(true);
  });

  it("a non-array split.field is flagged — a unit source iterates an array", () => {
    const lint = lintAgentSplit({
      ...VALID,
      output_schema: { type: "object", properties: { cost: { type: "integer" } } },
      split: { field: "cost", key_field: "id" },
    });
    expect(lint.problems.some((p) => /"cost" must be an array/.test(p.message))).toBe(true);
  });

  it("per-item paths must resolve in the array's element shape (defaults included)", () => {
    // the explicit selector misses the element fields
    const explicit = lintAgentSplit({ ...VALID, split: { field: "services", key_field: "key" } });
    expect(explicit.problems.some((p) => /split.key_field "key" .* element fields: id, title/.test(p.message))).toBe(true);
    // the DEFAULT key_field ("key") is checked too when the author never set it
    const defaulted = lintAgentSplit({ output: "json", output_schema: SPLIT_SOURCE_SCHEMA, split: { field: "services" } });
    expect(defaulted.problems.some((p) => /split.key_field "key"/.test(p.message))).toBe(true);
  });

  it("an unresolvable default target is flagged with the resolver's message", () => {
    const lint = lintAgentSplit({ ...VALID, split: { ...VALID.split, target: "nope" } });
    expect(lint.problems.some((p) => /unknown split target "nope"/.test(p.message))).toBe(true);
  });

  it("a resolvable target is clean; a template target's start contract must accept the item shape", () => {
    const docs = must(
      templateStore.createNodeTemplate({ key: "docs_target", name: "Docs", kind: "agent", config: {} }),
      "created target row",
    );
    expect(lintAgentSplit({ ...VALID, split: { ...VALID.split, target: docs.id } }).error).toBeNull();

    // a target with a strict start contract: the unit items must provide its
    // required fields and carry nothing outside it
    const strict = must(
      templateStore.createNodeTemplate({
        key: "strict_target",
        name: "Strict",
        kind: "agent",
        config: { contract: [{ key: "service", type: "string", required: true }] },
      }),
      "created strict row",
    );
    const lint = lintAgentSplit({ ...VALID, split: { ...VALID.split, target: strict.id } });
    expect(lint.problems.some((p) => /don't declare \["service"\]/.test(p.message))).toBe(true);
    expect(lint.problems.some((p) => /outside the target template.*start contract \(strict shape\): id, title/.test(p.message))).toBe(true);
  });
});
