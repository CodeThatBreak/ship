import { db } from "../../../db";
import { cursorClient, type CursorRunResult, type RunUsage } from "../../../integrations/cursor";

// ── cost & usage capture ─────────────────────────────────────────────────────

export interface PricingEntry { input_per_mtok?: number; output_per_mtok?: number; cache_read_per_mtok?: number }

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
  private estimateCostCents(usage: RunUsage, pricing: Record<string, PricingEntry>): { cents: number; model?: string } | null {
    const model = usage.model;
    const p = (model && pricing[model]) ?? pricing["*"] ?? pricing.default;
    if (!p) return null;
    const per = (v?: number, rate?: number) => ((v ?? 0) * (rate ?? 0)) / 1_000_000 * 100;
    const cents =
      per(usage.inputTokens, p.input_per_mtok) +
      per(usage.outputTokens, p.output_per_mtok) +
      per(usage.cacheReadTokens, p.cache_read_per_mtok);
    return { cents: Math.round(cents * 100) / 100, model };
  }

  persistUsage(
    runRowId: string,
    u: {
      model?: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
      durationMs?: number; costCents?: number; raw?: unknown;
    }
  ): void {
    db.run(
      `UPDATE runs SET model=COALESCE(?,model), input_tokens=?, output_tokens=?, cache_read_tokens=?,
         cache_write_tokens=?, duration_ms=?, cost_cents=?, usage=?, updated_at=? WHERE id=?`,
      u.model ?? null, u.input ?? null, u.output ?? null, u.cacheRead ?? null,
      u.cacheWrite ?? null, u.durationMs ?? null, u.costCents != null ? Math.round(u.costCents) : null,
      u.raw ? JSON.stringify(u.raw) : null, db.now(), runRowId
    );
  }

  /**
   * Persist a billed cloud usage payload (tokens + charged cost) onto the run
   * row, estimating cost from the pricing table when the API doesn't report it.
   */
  private persistBilledUsage(runRowId: string, usage: RunUsage): RunCostSummary {
    const pricing = db.getSetting<Record<string, PricingEntry>>("pricing", {});
    let costCents: number | undefined;
    let estimated = false;
    if (usage.cost?.chargedCents != null) {
      costCents = usage.cost.chargedCents;
    } else {
      const est = this.estimateCostCents(usage, pricing);
      if (est) { costCents = est.cents; estimated = true; }
    }
    const tokens =
      usage.totalTokens ??
      (((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0)) || undefined);
    this.persistUsage(runRowId, {
      model: usage.model,
      input: usage.inputTokens, output: usage.outputTokens,
      cacheRead: usage.cacheReadTokens, cacheWrite: usage.cacheWriteTokens,
      costCents, raw: usage,
    });
    return { tokens, costCents, estimated, model: usage.model };
  }

  /**
   * Unified usage capture for a finished run, regardless of runtime.
   *
   * Token counts come from the run result's `usage` (the SDK reports them for
   * both local and cloud runs). Cloud runs additionally get billed cost from
   * the usage API (estimating from the pricing table when charge-reporting is
   * off); local runs skip billed cost (the SDK's local getUsage is account-
   * gated) and report tokens + duration only.
   */
  async captureRunUsage(opts: {
    runRowId: string;
    result: CursorRunResult;
    cloudAgentId?: string; // when set, fetch billed cost for this cloud run
    runId: string;
  }): Promise<RunCostSummary> {
    const { runRowId, result, cloudAgentId, runId } = opts;

    // Cloud: the billed-usage endpoint is the cost source of truth.
    if (cloudAgentId) {
      const billed = await cursorClient.getRunUsage(cloudAgentId, runId);
      if (billed) {
        const summary = this.persistBilledUsage(runRowId, billed);
        return { ...summary, durationMs: summary.durationMs ?? result.durationMs };
      }
      // fall through to token counts from the run result when billing is off
    }

    const u = result.usage;
    const model = result.model?.id;
    const tokens = u
      ? u.totalTokens || u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens || undefined
      : undefined;
    this.persistUsage(runRowId, {
      model,
      input: u?.inputTokens, output: u?.outputTokens,
      cacheRead: u?.cacheReadTokens, cacheWrite: u?.cacheWriteTokens,
      durationMs: result.durationMs, raw: u,
    });
    return { durationMs: result.durationMs, tokens, model };
  }
}

export const usageTracker = new UsageTracker();
