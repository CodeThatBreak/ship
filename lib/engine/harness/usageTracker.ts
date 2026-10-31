import "server-only";

import { db } from "../../db/app";
import { pricingTableSchema } from "../../schemas/settingValues";
import { uncachedInputTokens } from "../../usage";
import {
  agentPortRegistry,
  type AgentPort,
  type AgentRunResult,
  type AgentRunUsage,
  type PricingEntry,
} from "../ports/agentPort";
import { PricingSource } from "./pricingSource";

// ── cost & usage capture ─────────────────────────────────────────────────────

export type { PricingEntry };

/**
 * The effective rate card for a model: the remote source table with the
 * running vendor's `rateOverrides` merged on top, and the `pricing` setting
 * winning over it (exact model id, then the setting's own `"*"`/`"default"`
 * wildcard, then the merged table's longest-prefix entry).
 */
function resolveRates(
  model: string | undefined,
  pricing: Record<string, PricingEntry>,
  source: PricingSource,
  table: Record<string, PricingEntry>,
): PricingEntry {
  const exact = model ? pricing[model] : undefined;
  return exact ?? pricing["*"] ?? pricing.default ?? source.entryFor(model, table);
}

/**
 * Cost of a token payload at list price minus the given discount fraction
 * (the running port's `listDiscount` — a vendor billing-agreement fact), in
 * cents.
 */
/** See lib/usage.ts — uncached portion of a prompt-total input count. */

export function estimateCostCents(
  usage: { model?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number },
  rates: PricingEntry,
  discount = 0,
): { cents: number; model?: string } {
  const per = (v?: number, rate?: number) => ((v ?? 0) * (rate ?? 0)) / 1_000_000 * 100;
  const cents =
    (per(uncachedInputTokens(usage), rates.input_per_mtok) +
      per(usage.outputTokens, rates.output_per_mtok) +
      per(usage.cacheReadTokens, rates.cache_read_per_mtok) +
      per(usage.cacheWriteTokens, rates.cache_write_per_mtok)) *
    (1 - discount);
  return { cents: Math.round(cents * 100) / 100, model: usage.model };
}

/** The effective source table: the fetched remote table with the vendor's
 *  `rateOverrides` merged on top (overrides win). */
async function rateTable(
  source: PricingSource,
  overrides: Record<string, PricingEntry> | undefined,
): Promise<Record<string, PricingEntry>> {
  const remote = await source.entries();
  return overrides ? { ...remote, ...overrides } : remote;
}

/** Best billed figure for an entry: only > $0 counts. All-zero billed data
 *  (plan-included / BYOK usage reports $0 charged) is "reporting exists but
 *  no charge", which is useless for display — callers fall back to estimates. */
export function billedCents(cost?: { rawCostCents?: number; chargedCents?: number }): number | null {
  if (!cost) return null;
  if ((cost.chargedCents ?? 0) > 0) return cost.chargedCents ?? null;
  if ((cost.rawCostCents ?? 0) > 0) return cost.rawCostCents ?? null;
  return null;
}

export interface RunCostSummary {
  durationMs?: number;
  tokens?: number;
  costCents?: number;
  estimated?: boolean;
  model?: string;
}

/**
 * Token-usage and cost accounting for agent runs: fetches cloud usage,
 * estimates cost from the pricing table when the API doesn't charge-report,
 * and persists everything onto the run row.
 */
export class UsageTracker {
  /** one-shot guard: the estimate backfill only needs to run once per process */
  private backfilled = false;

  constructor(private readonly pricingSource: PricingSource = new PricingSource()) {}

  persistUsage(
    runRowId: string,
    u: {
      model?: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
      durationMs?: number; costCents?: number; raw?: unknown;
    }
  ): void {
    // COALESCE-backed partial update: unspecified columns keep their existing
    // value, so a duration-only touch (agent-runner after capture) can't wipe
    // the tokens/cost that were just persisted.
    db.run(
      `UPDATE runs SET model=COALESCE(?,model), input_tokens=COALESCE(?,input_tokens), output_tokens=COALESCE(?,output_tokens),
          cache_read_tokens=COALESCE(?,cache_read_tokens), cache_write_tokens=COALESCE(?,cache_write_tokens),
          duration_ms=COALESCE(?,duration_ms), cost_cents=COALESCE(?,cost_cents), usage=COALESCE(?,usage),
          updated_at=? WHERE id=?`,
      u.model ?? null, u.input ?? null, u.output ?? null, u.cacheRead ?? null,
      u.cacheWrite ?? null, u.durationMs ?? null, u.costCents != null ? Math.round(u.costCents) : null,
      u.raw ? JSON.stringify(u.raw) : null, db.now(), runRowId
    );
  }

  /**
   * Unified usage capture for a finished run, regardless of runtime.
   *
   * Cost comes from one of two sources, in order:
   *  1. a real > $0 billed charge from the vendor's usage API (`getUsage`
   *     is on a limited rollout — when it does report, that figure wins)
   *  2. our own calculation: the run's token counts × the rate card (the
   *     vendor's `rateOverrides` merged over the remote table), priced at
   *     the vendor's `listDiscount`
   *
   * Token counts come from whichever source served usage. See
   * {@link backfillCosts} for already-stored runs.
   */
  async captureRunUsage(opts: {
    runRowId: string;
    result: AgentRunResult;
    /** the port whose runtime executed the run (billed usage is a port concept) */
    port: AgentPort;
    /** when set (cloud runs), fetch billed cost for this run via the port */
    cloudAgentId?: string;
    runId: string;
  }): Promise<RunCostSummary> {
    const { runRowId, result, port, cloudAgentId, runId } = opts;

    // cloud: try the billed-usage endpoint first (usually unavailable — falls
    // through to the estimate); local runs are account-gated, never billed here
    const billed = cloudAgentId
      ? await port.getUsage({ agentId: cloudAgentId, runId })
      : null;
    // the runtime's usage maps 1:1 onto the loose AgentRunUsage shape we persist
    const u: AgentRunUsage | undefined = billed ?? (result.usage as unknown as AgentRunUsage | undefined);
    const model = u?.model ?? result.model?.id;
    if (!u) {
      this.persistUsage(runRowId, { durationMs: result.durationMs });
      return { durationMs: result.durationMs, model };
    }

    const realCost = billedCents(u.cost);
    const pricing = db.getSetting("pricing", pricingTableSchema, {});
    const est = realCost != null
      ? null
      : estimateCostCents(
          { model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens },
          resolveRates(model, pricing, this.pricingSource, await rateTable(this.pricingSource, port.rateOverrides)),
          port.listDiscount,
        );
    const costCents = realCost ?? est?.cents;
    const estimated = realCost == null && est?.cents != null;
    // Recompute instead of trusting u.totalTokens: the local turn usage's own
    // total double-counts cache reads (see uncachedInputTokens); the usage API
    // reports the same sum over already-uncached input, which this reproduces.
    const tokens =
      uncachedInputTokens(u) + (u.outputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0)
      || undefined;

    this.persistUsage(runRowId, {
      model,
      input: u.inputTokens, output: u.outputTokens,
      cacheRead: u.cacheReadTokens, cacheWrite: u.cacheWriteTokens,
      durationMs: result.durationMs, costCents,
      raw: estimated ? { ...u, costSource: "estimate" } : u,
    });
    return { durationMs: result.durationMs, tokens, costCents, estimated, model };
  }

  /**
   * One-shot (or after rates change via the `pricing` setting): give stored
   * runs a cost from our own calculation. Rows with tokens but no/0 cost —
   * legacy captures — and rows still marked as an estimate are re-priced with
   * the current rate card, always from the run's own stored token counts.
   * No usage API involved: the vendors' `getUsage` isn't broadly rolled out,
   * so our calculation is the only dependable source — stored cost = same
   * estimate a fresh run would get (vendor `rateOverrides` and discount
   * included).
   *
   * Stored rows don't record which runtime priced them, so the table merges
   * every registered port's `rateOverrides` and the discount comes from the
   * first cloud port (identical figures under a single registered harness;
   * diverging multi-harness discounts would need a per-run port column).
   */
  async backfillCosts(force = false): Promise<void> {
    if (this.backfilled && !force) return;
    this.backfilled = true;
    const pending = db.all<{
      id: string; model: string | null; usage: string | null;
      input_tokens: number | null; output_tokens: number | null;
      cache_read_tokens: number | null; cache_write_tokens: number | null;
    }>(
      `SELECT id, model, usage, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
       FROM runs
       WHERE (input_tokens IS NOT NULL OR output_tokens IS NOT NULL)
         AND (cost_cents IS NULL OR cost_cents = 0
              OR (usage IS NOT NULL AND usage LIKE '%"costSource":"estimate"%'))`);
    if (!pending.length) return;

    const pricing = db.getSetting("pricing", pricingTableSchema, {});
    const ports = agentPortRegistry.list();
    const overrides: Record<string, PricingEntry> = {};
    for (const p of ports) Object.assign(overrides, p.rateOverrides ?? {});
    const discount = (ports.find((p) => p.execMode === "cloud") ?? ports[0])?.listDiscount ?? 0;
    const table = await rateTable(this.pricingSource, overrides);
    for (const r of pending) {
      const est = estimateCostCents({
        model: r.model ?? undefined,
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
        cacheReadTokens: r.cache_read_tokens ?? 0,
        cacheWriteTokens: r.cache_write_tokens ?? 0,
      }, resolveRates(r.model ?? undefined, pricing, this.pricingSource, table), discount);
      // zero-token rows price to exactly 0 — leave them uncosted rather than
      // pretend a free run happened
      if (est?.cents == null || est.cents <= 0) continue;
      markEstimated(r.id, est.cents, r.usage);
    }
  }
}

/** Persist an estimated cost, flagging it in the usage JSON so a later
 *  backfill (e.g. after the pricing rates change) re-prices it. */
function markEstimated(runRowId: string, cents: number, existingUsage: string | null): void {
  let base: object | null = null;
  if (existingUsage != null) {
    try { base = JSON.parse(existingUsage) as object; } catch { /* unparseable older row — start from a fresh envelope */ }
  }
  const raw = JSON.stringify({ ...(base ?? {}), costSource: "estimate" });
  db.run(`UPDATE runs SET cost_cents=?, usage=?, updated_at=? WHERE id=?`, cents, raw, db.now(), runRowId);
}

export const usageTracker = new UsageTracker();
