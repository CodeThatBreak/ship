import { db } from "../../../db";
import { cursorClient, type CursorRunResult, type RunUsage } from "../../../integrations/cursor";
import type { LocalUsage } from "../../../integrations/localAgent";

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

  async captureCloudUsage(agentId: string, runId: string, runRowId: string): Promise<RunCostSummary> {
    const usage = await cursorClient.getRunUsage(agentId, runId);
    if (!usage) return {};
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

  persistLocalUsage(runRowId: string, usage: LocalUsage | null, result: CursorRunResult): RunCostSummary {
    const durationMs = usage?.durationMs ?? result.durationMs;
    if (!usage) {
      this.persistUsage(runRowId, { durationMs });
      return { durationMs };
    }
    const tokens =
      ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) +
       (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)) || undefined;
    this.persistUsage(runRowId, {
      model: usage.model,
      input: usage.inputTokens, output: usage.outputTokens,
      cacheRead: usage.cacheReadTokens, cacheWrite: usage.cacheWriteTokens,
      durationMs, raw: usage.raw,
    });
    return { durationMs, tokens, model: usage.model };
  }
}

export const usageTracker = new UsageTracker();
