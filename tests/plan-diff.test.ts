/**
 * The plan review layer (docs/plan-conversation-refine.md §6a/§6b): the
 * whole-plan diff machinery in components/flows/plan/utils/branchDiff.ts —
 * `pickWholeSteps`, `computeWholePlanDiff`, and the version-tab caption
 * builder `planTabCaption`, plus a smoke pass over the untouched
 * `diffBranchSteps` comparator the whole layer rides on.
 *
 * Pure modules — no DB, no React; only the `@` alias (vitest.config.mts).
 */
import { describe, expect, it } from "vitest";
import type { Artifact } from "@/types/flow";
import {
  diffBranchSteps,
  computeScopedDiff,
  pickWholeSteps,
  computeWholePlanDiff,
  planTabCaption,
} from "@/components/flows/plan/utils/branchDiff";
import { PLAN_TAB_CAPTION_MAX } from "@/components/flows/plan/constants";

// ── fixtures ─────────────────────────────────────────────────────────────────

const art = (version: number, meta: unknown): Artifact => ({
  id: `art_${version}`,
  kind: "plan",
  version,
  status: "awaiting_approval",
  created_at: "2026-10-29T00:00:00Z",
  meta: meta as Record<string, unknown>,
});

const step = (
  id: string,
  title: string,
  branch?: string,
): Record<string, unknown> => ({ id, title, detail: "d", branch: branch ?? null });

// three-version set: v1, v2 plain starts; v3 a refine with one changed step
// (auth), one added and one removed step (billing)
const V1 = [step("s0", "Overview")];
const V2 = [
  step("s1", "Auth setup", "auth"),
  step("s0", "Overview"),
  step("s3", "Billing page", "billing"),
];
const V3 = [
  step("s0", "Overview"),
  step("s1", "Auth setup with OAuth", "auth"),
  step("s4", "Invoices export", "billing"),
];

const planSet = (latestMeta: unknown): Artifact[] => [
  art(1, { steps: V1 }),
  art(2, { steps: V2 }),
  art(3, latestMeta),
];

// ── pickWholeSteps ───────────────────────────────────────────────────────────

describe("pickWholeSteps", () => {
  it("maps every step keeping its branch annotation", () => {
    expect(pickWholeSteps({ steps: V2 })).toMatchObject([
      { id: "s1", title: "Auth setup", branch: "auth" },
      { id: "s0", title: "Overview", branch: undefined },
      { id: "s3", title: "Billing page", branch: "billing" },
    ]);
  });

  it("returns empty on non-array or missing steps", () => {
    expect(pickWholeSteps(undefined)).toEqual([]);
    expect(pickWholeSteps({ steps: "nope" })).toEqual([]);
  });
});

// ── diffBranchSteps (comparator smoke — untouched behavior) ──────────────────

describe("diffBranchSteps", () => {
  it("diffs by id across added, removed and changed", () => {
    const diff = diffBranchSteps(V2, V3);
    expect(diff).toEqual({
      added: [{ id: "s4", title: "Invoices export", detail: "d", branch: "billing" }],
      removed: [{ id: "s3", title: "Billing page", detail: "d", branch: "billing" }],
      changed: [
        {
          id: "s1",
          before: { id: "s1", title: "Auth setup", detail: "d", branch: "auth" },
          after: { id: "s1", title: "Auth setup with OAuth", detail: "d", branch: "auth" },
        },
      ],
    });
  });

  it("returns empty on identical input", () => {
    const diff = diffBranchSteps(V2, [...V2]);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });
});

// ── computeWholePlanDiff ─────────────────────────────────────────────────────

describe("computeWholePlanDiff", () => {
  it("returns the exact v2→v3 change-set when the latest version carries refinedFrom", () => {
    const info = computeWholePlanDiff(
      planSet({ steps: V3, refinedFrom: { version: 2, source: "chat" } }),
    );
    expect(info).toEqual({
      fromVersion: 2,
      toVersion: 3,
      diff: {
        added: [{ id: "s4", title: "Invoices export", detail: "d", branch: "billing", files: undefined }],
        removed: [{ id: "s3", title: "Billing page", detail: "d", branch: "billing", files: undefined }],
        changed: [
          {
            id: "s1",
            before: { id: "s1", title: "Auth setup", detail: "d", branch: "auth", files: undefined },
            after: { id: "s1", title: "Auth setup with OAuth", detail: "d", branch: "auth", files: undefined },
          },
        ],
      },
    });
  });

  it("handles toggle-era versions: meta.feedback alone is a provenance mark", () => {
    const info = computeWholePlanDiff(planSet({ steps: V3, feedback: "add OAuth" }));
    expect(info).not.toBeNull();
    expect(info?.fromVersion).toBe(2);
    expect(info?.diff.changed).toHaveLength(1);
  });

  it("returns null for a plain-start latest version (no refinedFrom, no feedback)", () => {
    expect(computeWholePlanDiff(planSet({ steps: V3 }))).toBeNull();
  });

  it("returns null when the from-version artifact is absent", () => {
    const plans = [
      art(1, { steps: V1 }),
      art(4, { steps: V3, refinedFrom: { version: 3, source: "chat" } }),
    ];
    expect(computeWholePlanDiff(plans)).toBeNull();
  });

  it("returns null when the versions produced no change", () => {
    const info = computeWholePlanDiff(
      planSet({ steps: V2, refinedFrom: { version: 2, source: "start" } }),
    );
    expect(info).toBeNull();
  });

  it("returns null on an empty plan set", () => {
    expect(computeWholePlanDiff([])).toBeNull();
  });
});

// ── planTabCaption (§6b) ─────────────────────────────────────────────────────

describe("planTabCaption", () => {
  it("echoes the feedback truncated to 40 chars, curly-quoted", () => {
    const long = "move step 2 to phase one and make the billing branch optional";
    const caption = planTabCaption({ feedback: long });
    expect(caption?.startsWith("“")).toBe(true);
    expect(caption?.endsWith("…”")).toBe(true);
    // the inner short + ellipsis, wrapped in the two curly quotes
    expect(caption).toHaveLength(PLAN_TAB_CAPTION_MAX + 3);
    expect(planTabCaption({ feedback: "short note" })).toBe("“short note”");
  });

  it("names scoped-refine branches", () => {
    expect(
      planTabCaption({ scopedRefine: { branch: "auth", from: 1 } }),
    ).toBe("branch refine: auth");
  });

  it("labels chat refinements without feedback as refined in chat", () => {
    expect(planTabCaption({ refinedFrom: { version: 2, source: "chat" } })).toBe(
      "refined in chat",
    );
  });

  it("returns undefined for plain-start metas", () => {
    expect(planTabCaption(undefined)).toBeUndefined();
    expect(planTabCaption({ steps: [] })).toBeUndefined();
    expect(
      planTabCaption({ refinedFrom: { version: 2, source: "start" } }),
    ).toBeUndefined();
  });
});

// ── scoped-refine behavior regression guard (unchanged consumers) ────────────

describe("computeScopedDiff regression", () => {
  it("still computes the scoped banner data for a branch refine", () => {
    const scopedSet = [
      art(1, { steps: V2 }),
      art(2, {
        steps: [...V2, step("s5", "New billing row", "billing")],
        scopedRefine: { branch: "billing", from: 1 },
        refinedFrom: { version: 1, source: "branch" },
      }),
    ];
    const info = computeScopedDiff(scopedSet);
    expect(info).toEqual({
      branch: "billing",
      from: 1,
      to: 2,
      diff: {
        added: [{ id: "s5", title: "New billing row", detail: "d", branch: "billing" }],
        removed: [],
        changed: [],
      },
    });
  });
});
