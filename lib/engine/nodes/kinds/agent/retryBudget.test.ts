/**
 * Unit tests for the `retry_budget` defensive reader (Task 03): the config
 * layer wins; an absent or invalid value bows out to the caller's fallback
 * (the node class's `retryBudget`) — never throws a run down, same policy as
 * `splitConsumeOf`.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_RETRY_BUDGET, retryBudgetOf } from "./retryBudget";

describe("retryBudgetOf — the retry_budget knob's defensive reader", () => {
  it("the config layer wins over the class default", () => {
    expect(retryBudgetOf({ retry_budget: 3 }, 1)).toBe(3);
  });

  it("0 and 5 are the valid bounds", () => {
    expect(retryBudgetOf({ retry_budget: 0 }, 1)).toBe(0);
    expect(retryBudgetOf({ retry_budget: 5 }, 1)).toBe(5);
  });

  it("an absent knob bows out to the caller's fallback", () => {
    expect(retryBudgetOf({}, DEFAULT_RETRY_BUDGET)).toBe(DEFAULT_RETRY_BUDGET);
    expect(retryBudgetOf({ retry_budget: undefined }, 2)).toBe(2);
  });

  it("a null/foreign config bows out to the fallback", () => {
    expect(retryBudgetOf(null, 2)).toBe(2);
    expect(retryBudgetOf(undefined, 2)).toBe(2);
    expect(retryBudgetOf("nope", 2)).toBe(2);
  });

  it("invalid values bow out to the fallback — never throw", () => {
    expect(retryBudgetOf({ retry_budget: -1 }, 1)).toBe(1);
    expect(retryBudgetOf({ retry_budget: 6 }, 1)).toBe(1);
    expect(retryBudgetOf({ retry_budget: 1.5 }, 1)).toBe(1);
    expect(retryBudgetOf({ retry_budget: "2" }, 1)).toBe(1);
    expect(retryBudgetOf({ retry_budget: null }, 1)).toBe(1);
  });
});
