import { db } from "../../../db";
import { uncachedInputTokens } from "../../../usage";
import { cursorClient, type CursorRunResult, type RunUsage } from "../../../integrations/cursor";

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

/**
 * Built-in list-price table (USD per million tokens) so cost is populated even
 * when the operator hasn't configured a `pricing` setting.
 * Source: https://cursor.com/docs/models-and-pricing
 *
 * Matched by model-id prefix (longest key wins, so `gpt-5.1-codex-mini` beats
 * `gpt-5`) with a `*` wildcard fallback. The `pricing` setting, when present,
 * always wins over these entries. Fast-mode and long-context surcharges from
 * the docs (2x/3x price tiers, `[fast=…]` and `[context=…]` model variants)
 * are not modeled — the base rates are used.
 */
export const DEFAULT_PRICING: Record<string, PricingEntry> = {
  // Cursor models (Grok / Composer) — billed against the plan's usage pool
  "grok-4.7": { input_per_mtok: 2, output_per_mtok: 6, cache_read_per_mtok: 0.5 },
  "grok-4.6": { input_per_mtok: 2, output_per_mtok: 6, cache_read_per_mtok: 0.5 },
  "grok-4.5": { input_per_mtok: 2, output_per_mtok: 6, cache_read_per_mtok: 0.5 },
  "composer-2.5": { input_per_mtok: 0.5, output_per_mtok: 2.5, cache_read_per_mtok: 0.2 },

  // Anthropic — cache writes billed at 1.25x input
  "claude-4-sonnet": { input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75 },
  "claude-4.5-haiku": { input_per_mtok: 1, output_per_mtok: 5, cache_read_per_mtok: 0.1, cache_write_per_mtok: 1.25 },
  "claude-4.5-opus": { input_per_mtok: 5, output_per_mtok: 25, cache_read_per_mtok: 0.5, cache_write_per_mtok: 6.25 },
  "claude-4.5-sonnet": { input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75 },
  "claude-4.6-opus": { input_per_mtok: 5, output_per_mtok: 25, cache_read_per_mtok: 0.5, cache_write_per_mtok: 6.25 },
  "claude-4.6-sonnet": { input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75 },
  "claude-4.7-opus": { input_per_mtok: 5, output_per_mtok: 25, cache_read_per_mtok: 0.5, cache_write_per_mtok: 6.25 },
  "claude-fable-5.1": { input_per_mtok: 10, output_per_mtok: 50, cache_read_per_mtok: 0.25, cache_write_per_mtok: 12.5 },
  "claude-fable-5": { input_per_mtok: 10, output_per_mtok: 50, cache_read_per_mtok: 1, cache_write_per_mtok: 12.5 },
  "claude-haiku-5.5": { input_per_mtok: 0.1, output_per_mtok: 0.5, cache_read_per_mtok: 0.01, cache_write_per_mtok: 0.125 },
  "claude-opus-4.7-fast": { input_per_mtok: 30, output_per_mtok: 150, cache_read_per_mtok: 3, cache_write_per_mtok: 37.5 },
  "claude-opus-4.8": { input_per_mtok: 5, output_per_mtok: 25, cache_read_per_mtok: 0.5, cache_write_per_mtok: 6.25 },
  "claude-opus-5.5": { input_per_mtok: 4, output_per_mtok: 20, cache_read_per_mtok: 0.2, cache_write_per_mtok: 5 },
  "claude-opus-5": { input_per_mtok: 5, output_per_mtok: 25, cache_read_per_mtok: 0.5, cache_write_per_mtok: 6.25 },
  "claude-sonnet-5.5": { input_per_mtok: 2, output_per_mtok: 10, cache_read_per_mtok: 0.1, cache_write_per_mtok: 2.5 },
  "claude-sonnet-5": { input_per_mtok: 2, output_per_mtok: 10, cache_read_per_mtok: 0.2, cache_write_per_mtok: 2.5 },

  // Google — no separate cache-write charge
  "gemini-2.5-flash": { input_per_mtok: 0.3, output_per_mtok: 2.5, cache_read_per_mtok: 0.03 },
  "gemini-3-flash": { input_per_mtok: 0.5, output_per_mtok: 3, cache_read_per_mtok: 0.05 },
  "gemini-3.1-pro": { input_per_mtok: 2, output_per_mtok: 12, cache_read_per_mtok: 0.2 },
  "gemini-3-pro": { input_per_mtok: 2, output_per_mtok: 12, cache_read_per_mtok: 0.2 },
  "gemini-3.5-flash-lite": { input_per_mtok: 0.3, output_per_mtok: 2.5, cache_read_per_mtok: 0.03 },
  "gemini-3.5-flash": { input_per_mtok: 1.5, output_per_mtok: 9, cache_read_per_mtok: 0.15 },
  "gemini-3.6-flash": { input_per_mtok: 1.5, output_per_mtok: 7.5, cache_read_per_mtok: 0.15 },
  "gemini-3.7-flash": { input_per_mtok: 0.75, output_per_mtok: 3.75, cache_read_per_mtok: 0.075 },
  "gemini-3.8-flash": { input_per_mtok: 0.75, output_per_mtok: 3.75, cache_read_per_mtok: 0.075 },
  "gemini-4-argon": { input_per_mtok: 2, output_per_mtok: 10, cache_read_per_mtok: 0.1 },

  // Z.ai
  "glm-5.3-flash": { input_per_mtok: 0.15, output_per_mtok: 0.5, cache_read_per_mtok: 0.029 },
  "glm-5.3": { input_per_mtok: 1.4, output_per_mtok: 4.4, cache_read_per_mtok: 0.26 },
  "glm-5.2": { input_per_mtok: 1.4, output_per_mtok: 4.4, cache_read_per_mtok: 0.26 },

  // OpenAI — no separate cache-write charge
  "gpt-5.1-codex-max": { input_per_mtok: 1.25, output_per_mtok: 10, cache_read_per_mtok: 0.125 },
  "gpt-5.1-codex-mini": { input_per_mtok: 0.25, output_per_mtok: 2, cache_read_per_mtok: 0.025 },
  "gpt-5.1-codex": { input_per_mtok: 1.25, output_per_mtok: 10, cache_read_per_mtok: 0.125 },
  "gpt-5.2-codex": { input_per_mtok: 1.75, output_per_mtok: 14, cache_read_per_mtok: 0.175 },
  "gpt-5.3-codex": { input_per_mtok: 1.75, output_per_mtok: 14, cache_read_per_mtok: 0.175 },
  "gpt-5.4-mini": { input_per_mtok: 0.75, output_per_mtok: 4.5, cache_read_per_mtok: 0.075 },
  "gpt-5.4-nano": { input_per_mtok: 0.2, output_per_mtok: 1.25, cache_read_per_mtok: 0.02 },
  "gpt-5.4": { input_per_mtok: 2.5, output_per_mtok: 15, cache_read_per_mtok: 0.25 },
  "gpt-5.5": { input_per_mtok: 5, output_per_mtok: 30, cache_read_per_mtok: 0.5 },
  "gpt-5.6-luna": { input_per_mtok: 0.2, output_per_mtok: 1.2, cache_read_per_mtok: 0.02, cache_write_per_mtok: 0.25 },
  "gpt-5.6-sol": { input_per_mtok: 4, output_per_mtok: 20, cache_read_per_mtok: 0.4, cache_write_per_mtok: 5 },
  "gpt-5.6-terra": { input_per_mtok: 2, output_per_mtok: 12, cache_read_per_mtok: 0.2, cache_write_per_mtok: 2.5 },
  "gpt-5-mini": { input_per_mtok: 0.25, output_per_mtok: 2, cache_read_per_mtok: 0.025 },
  "gpt-5-codex": { input_per_mtok: 1.25, output_per_mtok: 10, cache_read_per_mtok: 0.125 },
  "gpt-5": { input_per_mtok: 1.25, output_per_mtok: 10, cache_read_per_mtok: 0.125 },
  gpt: { input_per_mtok: 1.25, output_per_mtok: 10, cache_read_per_mtok: 0.125 },

  // Moonshot
  "kimi-k2.7-code": { input_per_mtok: 0.95, output_per_mtok: 4, cache_read_per_mtok: 0.19 },
  "kimi-k3": { input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3 },

  // Meta
  "muse-spark-1.3": { input_per_mtok: 1.25, output_per_mtok: 4.25, cache_read_per_mtok: 0.15 },
  "muse-wonder": { input_per_mtok: 4, output_per_mtok: 20, cache_read_per_mtok: 0.2 },

  // family fallbacks (versioned keys above always win by longest-prefix)
  "claude-opus": { input_per_mtok: 5, output_per_mtok: 25, cache_read_per_mtok: 0.5, cache_write_per_mtok: 6.25 },
  "claude-haiku": { input_per_mtok: 0.1, output_per_mtok: 0.5, cache_read_per_mtok: 0.01, cache_write_per_mtok: 0.125 },
  claude: { input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75 },
  gemini: { input_per_mtok: 2, output_per_mtok: 12, cache_read_per_mtok: 0.2 }, // gemini 3 pro tier
  glm: { input_per_mtok: 1.4, output_per_mtok: 4.4, cache_read_per_mtok: 0.26 },
  kimi: { input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3 },
  muse: { input_per_mtok: 1.25, output_per_mtok: 4.25, cache_read_per_mtok: 0.15 },
  "*": { input_per_mtok: 2, output_per_mtok: 10, cache_read_per_mtok: 0.2 },
};

/** Model id → built-in pricing-table entry (`[variant]` suffixes stripped,
 *  longest prefix wins so opus/haiku beat the bare `claude` family). */
function defaultPricingEntry(model: string | undefined): PricingEntry {
  const id = (model ?? "").toLowerCase().split("[")[0];
  if (!id) return DEFAULT_PRICING["*"];
  const key = Object.keys(DEFAULT_PRICING)
    .filter((k) => k !== "*")
    .sort((a, b) => b.length - a.length)
    .find((k) => id.startsWith(k));
  return (key && DEFAULT_PRICING[key]) || DEFAULT_PRICING["*"];
}

/** Effective rate card for a model: configured `pricing` setting (exact id,
 *  then the setting's own `"*"` / `"default"` wildcard) over the built-in table. */
function pricingFor(model: string | undefined, pricing: Record<string, PricingEntry>): PricingEntry | null {
  const exact = model ? pricing[model] : undefined;
  return exact ?? pricing["*"] ?? pricing.default ?? defaultPricingEntry(model);
}

/**
 * Cost of a token payload at list price minus {@link ENTERPRISE_DISCOUNT}, in
 * cents. Returns null when there is no rate card for the model at all.
 */
/** See lib/usage.ts — uncached portion of a prompt-total input count. */
export { uncachedInputTokens };

export function estimateCostCents(
  usage: { model?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number },
  pricing: Record<string, PricingEntry> = {},
): { cents: number; model?: string } | null {
  const p = pricingFor(usage.model, pricing);
  if (!p) return null;
  const per = (v?: number, rate?: number) => ((v ?? 0) * (rate ?? 0)) / 1_000_000 * 100;
  const cents =
    (per(uncachedInputTokens(usage), p.input_per_mtok) +
      per(usage.outputTokens, p.output_per_mtok) +
      per(usage.cacheReadTokens, p.cache_read_per_mtok) +
      per(usage.cacheWriteTokens, p.cache_write_per_mtok)) *
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
    result: CursorRunResult;
    cloudAgentId?: string; // when set, fetch billed cost for this cloud run
    runId: string;
  }): Promise<RunCostSummary> {
    const { runRowId, result, cloudAgentId, runId } = opts;

    // cloud: try the billed-usage endpoint first (usually unavailable — falls
    // through to the estimate); local runs are account-gated, never billed here
    const billed = cloudAgentId ? await cursorClient.getRunUsage(cloudAgentId, runId) : null;
    // the SDK's TokenUsage maps 1:1 onto the loose RunUsage shape we persist
    const u: RunUsage | undefined = billed ?? (result.usage as unknown as RunUsage | undefined);
    const model = u?.model ?? result.model?.id;
    if (!u) {
      this.persistUsage(runRowId, { durationMs: result.durationMs });
      return { durationMs: result.durationMs, model };
    }

    const realCost = billedCents(u.cost);
    const pricing = db.getSetting<Record<string, PricingEntry>>("pricing", {});
    const est = realCost != null
      ? null
      : estimateCostCents({ model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens }, pricing);
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
    for (const r of pending) {
      const est = estimateCostCents({
        model: r.model ?? undefined,
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
        cacheReadTokens: r.cache_read_tokens ?? 0,
        cacheWriteTokens: r.cache_write_tokens ?? 0,
      }, pricing);
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
