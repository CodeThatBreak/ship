import type { PricingEntry } from "../../ports/agentPort";
import type { LiteLLMEntry } from "../types/liteLlmEntry";

/** One LiteLLM entry → `PricingEntry` (per-token → per-Mtok, ×1_000_000), or null when unusable. */
export const toPricingEntry = (value: unknown): PricingEntry | null => {
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
};
