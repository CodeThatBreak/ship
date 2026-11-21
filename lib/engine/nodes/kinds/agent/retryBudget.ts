import "server-only";

/** The `retry_budget` knob's domain values (Task 03): the schema bound and
 * the class default the defensive reader falls back to. */
export const RETRY_BUDGET_MIN = 0;
export const RETRY_BUDGET_MAX = 5;
export const DEFAULT_RETRY_BUDGET = 1;

/** The config record a knob reader accepts — a parsed def or any raw layer. */
const cfgRecordOf = (cfg: unknown): Record<string, unknown> =>
  cfg != null && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};

/**
 * Defensive read of the `retry_budget` knob (Task 03): the config layer wins,
 * the caller's fallback (the node class's `retryBudget`) is the floor — an
 * absent or invalid value bows out to it, never throwing a run down (same
 * policy as `splitConsumeOf`).
 */
export const retryBudgetOf = (cfg: unknown, fallback: number): number => {
  const v = cfgRecordOf(cfg).retry_budget;
  if (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= RETRY_BUDGET_MIN &&
    v <= RETRY_BUDGET_MAX
  ) {
    return v;
  }
  return fallback;
};
