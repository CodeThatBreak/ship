import "server-only";

import { db } from "../../../db/app";
import { RunRow } from "../../../db/rows";
import { pricingTableSchema } from "../../../schemas/settingValues";
import { uncachedInputTokens } from "../../../usage";
import {
  agentPortRegistry,
  type AgentPort,
  type AgentRunResult,
  type AgentRunUsage,
  type PricingEntry,
} from "../../ports/agentPort";
import { PricingSource } from "../pricingSource";
import { billedCents, estimateCostCents } from "../utils/estimateCostCents";
import { rateTable, resolveRates } from "../utils/resolveRates";
import { markEstimated } from "../utils/markEstimated";
import type { RunCostSummary } from "../types/runCostSummary";

/**
 * Token-usage and cost accounting for agent runs: fetches cloud usage,
 * estimates cost from the pricing table when the API doesn't charge-report,
 * and persists everything onto the run row.
 */
export class UsageTracker {
  /** one-shot guard: the estimate backfill only needs to run once per process */
  private backfilled = false;

  constructor(private readonly pricingSource: PricingSource = new PricingSource()) {}

  async persistUsage(
    runRowId: string,
    u: {
      model?: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
      durationMs?: number; costCents?: number; raw?: unknown;
    }
  ): Promise<void> {
    // COALESCE-backed partial update: unspecified columns keep their existing
    // value, so a duration-only touch (agent-runner after capture) can't wipe
    // the tokens/cost that were just persisted. Contained raw: a column-wise
    // COALESCE update has no Prisma query-API equivalent — read-then-write
    // would race the concurrent persist paths. Same statement is what keeps
    // the partial update atomic.
    await db.prisma.$executeRawUnsafe(
            `UPDATE runs SET model=COALESCE($1,model), input_tokens=COALESCE($2,input_tokens), output_tokens=COALESCE($3,output_tokens),
          cache_read_tokens=COALESCE($4,cache_read_tokens), cache_write_tokens=COALESCE($5,cache_write_tokens),
          duration_ms=COALESCE($6,duration_ms), cost_cents=COALESCE($7,cost_cents), usage=COALESCE($8,usage),
          updated_at=$9 WHERE id=$10`,
            u.model ?? null, u.input ?? null, u.output ?? null, u.cacheRead ?? null,
            u.cacheWrite ?? null, u.durationMs ?? null, u.costCents != null ? Math.round(u.costCents) : null,
            u.raw ?? null, db.now(), runRowId
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
      await this.persistUsage(runRowId, { durationMs: result.durationMs });
      return { durationMs: result.durationMs, model };
    }

    const realCost = billedCents(u.cost);
    const pricing = await db.getSetting("pricing", pricingTableSchema, {});
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

    await this.persistUsage(runRowId, {
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
    const pending = await db.prisma.run.findMany({
      where: {
        AND: [
          { OR: [{ inputTokens: { not: null } }, { outputTokens: { not: null } }] },
          {
            OR: [
              { costCents: null },
              { costCents: 0 },
              // stored usage marked as an estimate is re-priced with the current card
              { usage: { path: ["costSource"], equals: "estimate" } },
            ],
          },
        ],
      },
      select: {
        id: true,
        model: true,
        usage: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
      },
    });
    if (!pending.length) return;

    const pricing = await db.getSetting("pricing", pricingTableSchema, {});
    const ports = agentPortRegistry.list();
    const overrides: Record<string, PricingEntry> = {};
    for (const p of ports) Object.assign(overrides, p.rateOverrides ?? {});
    const discount = (ports.find((p) => p.execMode === "cloud") ?? ports[0])?.listDiscount ?? 0;
    const table = await rateTable(this.pricingSource, overrides);
    for (const r of pending) {
      // the usage JSONB payload stays narrowed at the boundary (zod) — a
      // non-object stored cell prices like an uncosted run
      const usage = RunRow.shape.usage.nullable().catch(null).parse(r.usage);
      const est = estimateCostCents({
        model: r.model ?? undefined,
        inputTokens: r.inputTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        cacheReadTokens: r.cacheReadTokens ?? 0,
        cacheWriteTokens: r.cacheWriteTokens ?? 0,
      }, resolveRates(r.model ?? undefined, pricing, this.pricingSource, table), discount);
      // zero-token rows price to exactly 0 — leave them uncosted rather than
      // pretend a free run happened
      if (est?.cents == null || est.cents <= 0) continue;
      await markEstimated(r.id, est.cents, usage);
    }
  }
}

