/**
 * Cost estimation (lib/engine/harness/usage-tracker.ts): the token-based
 * estimate must price at the rate card minus the running port's vendor
 * `listDiscount`, and the vendor's `rateOverrides` must win over the remote
 * pricing source's table — the port-owned facts that replaced the hardcoded
 * Cursor constant in the engine.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Must run before any `../../db` import touches the connection — dynamic
// imports below execute in statement order after the static ones hoist.
process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-usage-tracker-")),
  "test.db",
);

const { estimateCostCents, UsageTracker } = await import("./usage-tracker");
const { PricingSource } = await import("./pricing-source");
import type { AgentPort, AgentRunResult, PricingEntry } from "../ports/agent-port";
import type { PricingSource as PricingSourceT } from "./pricing-source";

/** Minimal port stub: only the cost facts the estimator reads. */
function fakePort(listDiscount: number, rateOverrides?: Record<string, PricingEntry>): AgentPort {
  return {
    kind: "stub",
    label: "Stub",
    harness: "stub",
    execMode: "cloud",
    fallbackModels: [],
    listDiscount,
    rateOverrides,
    start: () => Promise.reject(new Error("not used")),
    stream: () => Promise.reject(new Error("not used")),
    getRun: () => Promise.reject(new Error("not used")),
    cancel: () => Promise.reject(new Error("not used")),
    hasActiveRun: () => false,
    releaseActiveRun: () => {},
    getUsage: () => Promise.reject(new Error("not used")),
    inspectSession: () => Promise.reject(new Error("not used")),
    listCatalog: () => Promise.reject(new Error("not used")),
    status: () => Promise.reject(new Error("not used")),
  };
}

/** PricingSource stub: entryFor resolves an exact id (or the wildcard). */
function stubSource(table: Record<string, PricingEntry>): PricingSourceT {
  return {
    entries: () => Promise.resolve(table),
    entryFor: (model: string | undefined, t: Record<string, PricingEntry>) =>
      (model && t[model]) ?? t["*"],
  } as unknown as PricingSourceT;
}

describe("estimateCostCents", () => {
  const RATES: PricingEntry = { input_per_mtok: 2, output_per_mtok: 10 };
  const USAGE = { model: "m", inputTokens: 1_000_000, outputTokens: 100_000 };

  it("prices at list when the discount is 0", () => {
    // 1M uncached input @ $2/Mtok = 200¢; 100k output @ $10/Mtok = 100¢
    expect(estimateCostCents(USAGE, RATES, 0).cents).toBe(300);
  });

  it("applies the vendor discount fraction", () => {
    expect(estimateCostCents(USAGE, RATES, 0.07).cents).toBe(279);
  });

  it("prices only the uncached input portion (lib/usage.ts semantics)", () => {
    // prompt-total input: 1M with 800k already priced as cache reads
    const est = estimateCostCents(
      { model: "m", inputTokens: 1_000_000, cacheReadTokens: 800_000 },
      { input_per_mtok: 2, cache_read_per_mtok: 0.2 },
      0,
    );
    // 200k uncached @ $2 = 40¢; 800k reads @ $0.2 = 16¢
    expect(est.cents).toBe(56);
  });
});

describe("captureRunUsage estimate path", () => {
  it("prices at the port's rateOverrides and listDiscount (overrides win)", async () => {
    // remote table carries an absurd rate for the model — proves the override wins
    const tracker = new UsageTracker(stubSource({
      "vendor-x": { input_per_mtok: 1000, output_per_mtok: 1000 },
    }));
    const port = fakePort(0.07, { "vendor-x": { input_per_mtok: 1, output_per_mtok: 2, cache_read_per_mtok: 0.1 } });
    const result: AgentRunResult = {
      status: "finished",
      usage: { model: "vendor-x", inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 500_000 },
    };
    const summary = await tracker.captureRunUsage({ runRowId: "missing-row", result, port, runId: "run_test" });
    // uncached input 500k @ $1 = 50¢; output 100k @ $2 = 20¢; reads 500k @ $0.1 = 5¢
    // → 75¢ × (1 - 0.07) = 69.75¢, flagged as an estimate
    expect(summary.costCents).toBe(69.75);
    expect(summary.estimated).toBe(true);
    // recomputed token count: uncached input + output + cache volumes
    expect(summary.tokens).toBe(1_100_000);
  });

  it("uses a billed charge as-is (no estimate, no discount)", async () => {
    const tracker = new UsageTracker(stubSource({}));
    const port = fakePort(0.07);
    const result: AgentRunResult = {
      status: "finished",
      usage: { model: "vendor-x", inputTokens: 1_000_000, cost: { chargedCents: 100 } },
    };
    const summary = await tracker.captureRunUsage({ runRowId: "missing-row", result, port, runId: "run_test" });
    expect(summary.costCents).toBe(100);
    expect(summary.estimated).toBe(false);
  });
});

describe("PricingSource", () => {
  it("maps per-token entries to per-Mtok and leaves vendor injection to the ports", async () => {
    const source = new PricingSource();
    // reflect over the private fetch path via the stubbed global fetch
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      "some/gpt-x": { mode: "chat", input_cost_per_token: 0.000001, output_cost_per_token: 0.00001 },
      "bad/*": { mode: "chat", input_cost_per_token: 9 },
      "embed-y": { mode: "embedding", input_cost_per_token: 0.000001 },
    }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const table = await source.entries();
      expect(table["gpt-x"]).toEqual({ input_per_mtok: 1, output_per_mtok: 10, cache_read_per_mtok: undefined, cache_write_per_mtok: undefined });
      expect(table["bad/*"]).toBeUndefined();
      expect(table["embed-y"]).toBeUndefined();
      expect(Object.keys(table).some((k) => k === "composer-2.5" || k === "grok-4")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
