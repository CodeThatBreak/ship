import { describe, expect, it } from "vitest";

import { parseUsagePayload, sumUsageArtifacts } from "./usageRollup";

const usageJson = (u: unknown): string => JSON.stringify(u);

describe("sumUsageArtifacts (Task 21 — the flow-header rollup)", () => {
  it("sums the usage artifacts across multiple runs", () => {
    const rollup = sumUsageArtifacts([
      usageJson({ model: "claude-sonnet-4", inputTokens: 1000, outputTokens: 200, cacheReadTokens: 500, cacheWriteTokens: 100, costCents: 10 }),
      usageJson({ model: "claude-sonnet-4", inputTokens: 2000, outputTokens: 300, cacheReadTokens: 700, cacheWriteTokens: 100, costCents: 15 }),
      usageJson({ model: "gpt-5", inputTokens: 400, outputTokens: 100, costCents: 3, estimated: true }),
    ]);

    expect(rollup).not.toBeNull();
    expect(rollup?.runs).toBe(3);
    expect(rollup?.inputTokens).toBe(3400);
    expect(rollup?.outputTokens).toBe(600);
    expect(rollup?.cacheTokens).toBe(1400);
    expect(rollup?.costCents).toBe(28);
    expect(rollup?.estimatedRuns).toBe(1);
    // per-model breakdown, first-seen order
    expect(rollup?.models).toEqual([
      { model: "claude-sonnet-4", runs: 2, inputTokens: 3000, outputTokens: 500, cacheTokens: 1400, costCents: 25 },
      { model: "gpt-5", runs: 1, inputTokens: 400, outputTokens: 100, cacheTokens: 0, costCents: 3 },
    ]);
  });

  it("counts every stored version — a re-run's usage is another run, not a replacement", () => {
    const rollup = sumUsageArtifacts([
      usageJson({ model: "m", inputTokens: 10, outputTokens: 5, costCents: 1 }),
      usageJson({ model: "m", inputTokens: 10, outputTokens: 5, costCents: 1 }),
    ]);
    expect(rollup?.runs).toBe(2);
    expect(rollup?.costCents).toBe(2);
  });

  it("returns null when no run established a usage artifact", () => {
    expect(sumUsageArtifacts([])).toBeNull();
  });

  it("skips rows that are not usage payloads (tolerant read)", () => {
    expect(sumUsageArtifacts(["not json", usageJson([]), usageJson({}), usageJson({ outputTokens: 7 })]))
      .toEqual({
        runs: 1,
        inputTokens: 0,
        outputTokens: 7,
        cacheTokens: 0,
        costCents: 0,
        estimatedRuns: 0,
        models: [{ model: "unknown", runs: 1, inputTokens: 0, outputTokens: 7, cacheTokens: 0, costCents: 0 }],
      });
  });
});

describe("parseUsagePayload", () => {
  it("narrows the stored JSON tolerantly", () => {
    expect(parseUsagePayload(usageJson({ model: "m", inputTokens: 5, costCents: 2, estimated: true, durationMs: 100 })))
      .toEqual({ model: "m", inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costCents: 2, estimated: true });
    expect(parseUsagePayload("not json")).toBeNull();
    expect(parseUsagePayload(usageJson("scalar"))).toBeNull();
    // a duration-only payload carries no usage facts
    expect(parseUsagePayload(usageJson({ durationMs: 100 }))).toBeNull();
  });
});
