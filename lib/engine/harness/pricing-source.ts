import "server-only";

import { TtlCache } from "../../cache";
import type { PricingEntry } from "../ports/agent-port";

/** LiteLLM pricing entry — the fields DevFlow maps onto a rate card. */
interface LiteLLMEntry {
  mode?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_write_input_token_cost?: number;
}

/** One LiteLLM entry → `PricingEntry` (per-token → per-Mtok, ×1_000_000), or null when unusable. */
function toPricingEntry(value: unknown): PricingEntry | null {
  if (!value || typeof value !== "object") return null;
  const e = value as LiteLLMEntry;
  // chat models only — embeddings/audio/images price on a different axis
  if (e.mode && e.mode !== "chat") return null;
  const entry: PricingEntry = {};
  const per = (v?: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v * 1_000_000 : undefined);
  entry.input_per_mtok = per(e.input_cost_per_token);
  entry.output_per_mtok = per(e.output_cost_per_token);
  entry.cache_read_per_mtok = per(e.cache_read_input_token_cost);
  entry.cache_write_per_mtok = per(e.cache_write_input_token_cost);
  if (!entry.input_per_mtok && !entry.output_per_mtok && !entry.cache_read_per_mtok && !entry.cache_write_per_mtok) {
    return null;
  }
  return entry;
}

/**
 * Source of the model rate card (USD per million tokens) for cost estimates.
 * The table is fetched from LiteLLM's community pricing JSON and cached in
 * memory (TTL); a fetch failure NEVER breaks cost tracking — callers get a
 * minimal static wildcard table instead. Vendor-specific rates and discounts
 * are port facts (`AgentPort.rateOverrides` / `AgentPort.listDiscount`), not
 * part of this source.
 */
export class PricingSource {
  /** LiteLLM's community-maintained model pricing table (per-token costs). */
  private static readonly SOURCE_URL =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
  /** The table is fetched no more often than this. */
  private static readonly TTL_MS = 6 * 60 * 60 * 1000;
  /** Refetch backoff after a failure, so a broken source isn't hit per run. */
  private static readonly FAILURE_BACKOFF_MS = 10 * 60 * 1000;
  /** Last-resort rate card when the source is unreachable. */
  private static readonly FALLBACK: Record<string, PricingEntry> = {
    "*": { input_per_mtok: 2, output_per_mtok: 10, cache_read_per_mtok: 0.2 },
  };

  private readonly table = new TtlCache<Record<string, PricingEntry>>(PricingSource.TTL_MS);
  private failureUntil = 0;

  /** The rate card: the cached remote table (vendor overrides merge on top
   *  at the estimator — `UsageTracker.rateTable`). */
  async entries(): Promise<Record<string, PricingEntry>> {
    const cached = this.table.get("table");
    if (cached) return cached;
    if (Date.now() < this.failureUntil) return PricingSource.FALLBACK;
    const fetched = await this.fetchTable();
    if (fetched) {
      this.table.set("table", fetched);
      return fetched;
    }
    this.failureUntil = Date.now() + PricingSource.FAILURE_BACKOFF_MS;
    return PricingSource.FALLBACK;
  }

  /** Longest-prefix entry lookup over a table, wildcard fallback included. */
  entryFor(model: string | undefined, table: Record<string, PricingEntry>): PricingEntry {
    const id = (model ?? "").toLowerCase().split("[")[0];
    if (!id) return PricingSource.FALLBACK["*"];
    const key = Object.keys(table)
      .filter((k) => k !== "*")
      .sort((a, b) => b.length - a.length)
      .find((k) => id.startsWith(k));
    return (key && table[key]) || PricingSource.FALLBACK["*"];
  }

  /**
   * Fetch + map the remote table. LiteLLM's community table is used as-is;
   * anything unparseable is skipped. null = unreachable/unusable.
   */
  private async fetchTable(): Promise<Record<string, PricingEntry> | null> {
    let json: unknown;
    try {
      const res = await fetch(PricingSource.SOURCE_URL);
      if (!res.ok) return null;
      json = await res.json();
    } catch {
      return null;
    }
    if (!json || typeof json !== "object") return null;
    const mapped: Record<string, PricingEntry> = {};
    for (const [rawKey, value] of Object.entries(json as Record<string, unknown>)) {
      // litellm keys may carry provider/deployment prefixes ("openai/gpt-…") —
      // keep the bare model id so prefix matching works on runtime model ids
      const key = rawKey.includes("/") ? rawKey.split("/").pop() ?? "" : rawKey;
      // wildcard-ish collections ("provider/*") would poison the wildcard slot
      if (!key || key.includes("*")) continue;
      const entry = toPricingEntry(value);
      if (!entry) continue;
      if (!mapped[key]) mapped[key] = entry; // first occurrence wins
    }
    return mapped;
  }
}
