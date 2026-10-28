import { db } from "../../db";
import { uncachedInputTokens } from "../../usage";
import { type AgentPort, type AgentRunResult, type AgentRunUsage } from "../ports/agent-port";
import { PricingSource } from "./pricing-source";

// ── cost & usage capture ─────────────────────────────────────────────────────

export interface PricingEntry {
  input_per_mtok?: number;
  output_per_mtok?: number;
  cache_read_per_mtok?: number;
  cache_write_per_mtok?: number;
}

/**
 * Fraction off Cursor's list prices that our Enterprise plan is billed at
 * (7%). Applied to our own token-based cost calculation. When the usage API
 * does report a real billed charge, that figure is used as-is — Cursor
 * discounts it at billing time already.
 */
export const ENTERPRISE_DISCOUNT = 0.07;

/** Effective rate card for a model: configured `pricing` setting (exact id,
 *  then the setting's own `"*"` / `"default"` wildcard) over the fetched
 *  source table (LiteLLM + the Cursor-specific static keys). */
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
 * Cost of a token payload at list price minus {@link ENTERPRISE_DISCOUNT},
 * in cents.
 */
/** See lib/usage.ts — uncached portion of a prompt-total input count. */

export function estimateCostCents(
  usage: { model?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number },
  rates: PricingEntry,
): { cents: number; model?: string } {
  const per = (v?: number, rate?: number) => ((v ?? 0) * (rate ?? 0)) / 1_000_000 * 100;
  const cents =
    (per(uncachedInputTokens(usage), rates.input_per_mtok) +
      per(usage.outputTokens, rates.output_per_mtok) +
      per(usage.cacheReadTokens, rates.cache_read_per_mtok) +
      per(usage.cacheWriteTokens, rates.cache_write_per_mtok)) *
    (1 - ENTERPRISE_DISCOUNT);
  return { cents: Math.round(cents * 100) / 100, model: usage.model };
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
   *  1. a real > $0 billed charge from the cloud usage API (`Agent.getUsage`
   *     is on a limited rollout — when it does report, that figure wins)
   *  2. our own calculation: the run's token counts × the rate card, with the
   *     Enterprise discount applied
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
    const pricing = db.getSetting<Record<string, PricingEntry>>("pricing", {});
    const est = realCost != null
      ? null
      : estimateCostCents(
          { model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens },
          resolveRates(model, pricing, this.pricingSource, await this.pricingSource.entries()),
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
   * No usage API involved: `Agent.getUsage` isn't broadly rolled out, so our
   * calculation is the only dependable source — stored cost = same estimate a
   * fresh run would get, Enterprise discount included.
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

    const pricing = db.getSetting<Record<string, PricingEntry>>("pricing", {});
    const source = await this.pricingSource.entries();
    for (const r of pending) {
      const est = estimateCostCents({
        model: r.model ?? undefined,
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
        cacheReadTokens: r.cache_read_tokens ?? 0,
        cacheWriteTokens: r.cache_write_tokens ?? 0,
      }, resolveRates(r.model ?? undefined, pricing, this.pricingSource, source));
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
