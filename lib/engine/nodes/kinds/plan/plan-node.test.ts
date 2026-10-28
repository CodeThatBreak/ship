/**
 * Plan-node domain pieces on the agent-node infrastructure: the ONE response
 * schema (plan-domain rules as refinements, carrying the old validator
 * messages verbatim — the retry feedback text depends on them), the
 * deterministic scoped-refine merge/diff, and the generated output-contract
 * schemas.
 *
 * Runs against an isolated temp SQLite DB: DATABASE_PATH is read lazily by
 * lib/config.ts, so setting it before the first `db` import isolates the
 * singleton (AGENTS.md §1 — never a real database). The imports hoist it —
 * dynamic imports keep the order.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-plan-node-")),
  "test.db",
);

// the registry instantiates every builtin on first load — resolve its import
// cycle from here (not from a mid-evaluation node class) so all classes are
// fully initialized before plan-node is imported
await import("../../registry");
const { mergeBranchRefine, diffBranchSteps } = await import("./plan-node");
const {
  PLAN_RESPONSE_JSON_SCHEMA,
  SUB_PLAN_RESPONSE_JSON_SCHEMA,
  PlanResponse,
  SubPlanResponse,
  withStepIds,
} = await import("./schema");
import type { PlanMeta, PlanStep } from "./schema";

/** Messages of a schema's violations for one payload. */
const messagesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : result.error!.issues.map((i) => i.message);

const step = (id: string, title: string, branch: string | null = null): PlanStep => ({
  id, title, detail: "d", files: ["f.ts"], branch,
});

const metaWithTwoBranches = (): PlanMeta => ({
  steps: [
    step("s1", "Auth service", "auth"),
    step("s2", "Billing table", "billing"),
    step("s3", "Auth tokens", "auth"),
    step("s4", "Billing invoice", "billing"),
  ],
  branches: [
    { name: "auth", title: "Auth", scope: "logins", files: ["a.ts"], steps: ["Auth service", "Auth tokens"], dependsOn: [] },
    {
      name: "billing", title: "Billing", scope: "invoices", files: ["b.ts"], steps: ["Billing table", "Billing invoice"],
      dependsOn: ["auth"], subPlan: { prompt: "do billing stuff", steps: [] },
    },
  ],
});

/** s2 unchanged, s4 reworded + file added, s5 added, s3 re-emitted (collides
 *  with a kept auth step → the merge must re-id it). */
const billingRefine = {
  markdown: "## Billing sub-plan (refined)",
  steps: [
    step("s2", "Billing table"),
    { ...step("s4", "Billing invoice"), detail: "d4-revised", files: ["b.ts", "c.ts"] },
    step("s5", "Stripe sync"),
    step("s3", "Echo collision"),
  ],
};

describe("PlanResponse — the one plan schema (plan rules as refinements)", () => {
  const valid = {
    markdown: "# Plan",
    steps: [step("s1", "First"), step("s2", "Second")],
  };

  it("accepts a branchless plan", () => {
    expect(PlanResponse.safeParse(valid).success).toBe(true);
  });

  it("accepts a branched plan with resolvable cross-references", () => {
    const branched = {
      ...valid,
      branches: [
        { name: "auth", title: "Auth", files: [], steps: [], dependsOn: [] },
        { name: "billing", title: "Billing", files: [], steps: [], dependsOn: ["auth"] },
      ],
    };
    expect(PlanResponse.safeParse(branched).success).toBe(true);
  });

  it("rejects duplicate branch names — the old validator message", () => {
    const msgs = messagesOf(PlanResponse.safeParse({
      ...valid,
      branches: [
        { name: "auth", title: "A", files: [], steps: [], dependsOn: [] },
        { name: "auth", title: "A again", files: [], steps: [], dependsOn: [] },
      ],
    }));
    expect(msgs).toContain('duplicate branch name "auth"');
  });

  it("rejects dependsOn references to unknown branches — the old validator message", () => {
    const msgs = messagesOf(PlanResponse.safeParse({
      ...valid,
      branches: [{ name: "auth", title: "A", files: [], steps: [], dependsOn: ["nope"] }],
    }));
    expect(msgs).toContain('dependsOn references unknown branch "nope"');
  });

  it("rejects steps referencing unknown branches — the old validator message", () => {
    const msgs = messagesOf(PlanResponse.safeParse({
      markdown: "# Plan",
      steps: [step("s1", "First", "ghost")],
      branches: [{ name: "auth", title: "A", files: [], steps: [], dependsOn: [] }],
    }));
    expect(msgs).toContain('step "s1" references unknown branch "ghost"');
  });

  it("rejects duplicate step ids — the old validator message", () => {
    const msgs = messagesOf(PlanResponse.safeParse({
      ...valid,
      steps: [step("s1", "First"), step("s1", "Again")],
    }));
    expect(msgs).toContain('duplicate step id "s1"');
  });

  it("withStepIds fills missing ids in order (s1, s2, …)", () => {
    const filled = withStepIds([
      { title: "First", detail: "", files: [], branch: null },
      { title: "Second", detail: "", files: [], branch: null },
    ]);
    expect(filled.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});

describe("SubPlanResponse — the scoped refine's contract", () => {
  it("rejects an empty step list", () => {
    expect(SubPlanResponse.safeParse({ markdown: "m", steps: [] }).success).toBe(false);
  });

  it("tolerates an agent echoing a foreign branch name — merge forces it", () => {
    const parsed = SubPlanResponse.safeParse({
      markdown: "m",
      steps: [{ title: "t", detail: "d", files: [], branch: "other-branch" }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.steps[0].branch).toBe("other-branch");
  });
});

describe("mergeBranchRefine — deterministic scoped merge (§5)", () => {
  it("splices the branch's new steps in place and re-ids collisions", () => {
    const merged = mergeBranchRefine(metaWithTwoBranches(), "billing", billingRefine);
    const ids = merged.steps.map((s) => s.id);

    // global order preserved; auth steps untouched at their positions
    expect(ids[0]).toBe("s1");
    expect(ids[ids.length - 1]).toBe("s3");
    // no duplicate ids after the merge; the colliding "s3" was re-id'd
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[4]).not.toBe("s3");
  });

  it("updates the branch record and preserves the sub-plan prompt", () => {
    const merged = mergeBranchRefine(metaWithTwoBranches(), "billing", billingRefine);
    const billing = merged.branches.find((b) => b.name === "billing")!;
    expect(billing.markdown).toBe(billingRefine.markdown);
    expect(billing.subPlan?.prompt).toBe("do billing stuff");
    expect(billing.subPlan?.steps).toHaveLength(4);
    // every merged billing step carries the forced branch name
    expect(merged.steps.filter((s) => s.branch === "billing")).toHaveLength(4);
  });

  it("leaves other branches byte-identical", () => {
    const meta = metaWithTwoBranches();
    const merged = mergeBranchRefine(meta, "billing", billingRefine);
    expect(JSON.stringify(merged.branches[0])).toBe(JSON.stringify(meta.branches[0]));
    expect(merged.steps.filter((s) => s.branch === "auth")).toEqual(
      meta.steps.filter((s) => s.branch === "auth"),
    );
  });

  it("throws on an unknown branch name", () => {
    expect(() => mergeBranchRefine(metaWithTwoBranches(), "ghost", billingRefine)).toThrow();
  });
});

describe("diffBranchSteps — id-based with a title fallback (§6)", () => {
  it("classifies added/removed/changed against the id-preserving merge", () => {
    const meta = metaWithTwoBranches();
    const merged = mergeBranchRefine(meta, "billing", billingRefine);
    const oldSteps = meta.steps.filter((s) => s.branch === "billing");
    const newSteps = merged.steps.filter((s) => s.branch === "billing");
    const diff = diffBranchSteps(oldSteps, newSteps);
    // s2 unchanged (kept id), s4 changed, s5 added, collision re-id'd → added
    expect(diff.changed.map((c) => c.id)).toEqual(["s4"]);
    expect(diff.removed).toHaveLength(0);
    expect(diff.added.map((s) => s.title).sort()).toEqual(["Echo collision", "Stripe sync"]);
  });

  it("promotes a renamed id on unchanged content to changed via the title fallback", () => {
    const diff = diffBranchSteps(
      [
        { id: "w1", title: "Same work", detail: "x", files: [], branch: null },
        { id: "w2", title: "Other", detail: "y", files: [], branch: null },
      ],
      [
        { id: "zz9", title: "Same work", detail: "x", files: [], branch: null },
        { id: "w2", title: "Other", detail: "y", files: [], branch: null },
      ],
    );
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].id).toContain("w1");
  });
});

describe("the generated output-contract schemas", () => {
  it("renders both contracts as JSON Schema objects (recursion included)", () => {
    expect(PLAN_RESPONSE_JSON_SCHEMA).toBeTypeOf("object");
    expect(SUB_PLAN_RESPONSE_JSON_SCHEMA).toBeTypeOf("object");
    expect(JSON.stringify(SUB_PLAN_RESPONSE_JSON_SCHEMA)).toContain('"markdown"');
  });
});
