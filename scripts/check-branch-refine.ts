/**
 * Sanity checks for the branch-scoped refine Phase A engine pieces:
 * mergeBranchRefine (id preservation, in-place splicing, branch record update)
 * + validateSubPlan. Run: node --experimental-strip-types scripts/check-branch-refine.ts
 */
import { mergeBranchRefine, diffBranchSteps } from "../lib/engine/nodes/plan/plan-node";
import { validateSubPlan } from "../lib/engine/nodes/plan/schema";

// ── fixture: meta with two branches interleaved ─────────────────────────────
const meta = {
  steps: [
    { id: "s1", title: "Auth service", detail: "d1", files: ["a.ts"], branch: "auth" },
    { id: "s2", title: "Billing table", detail: "d2", files: ["b.ts"], branch: "billing" },
    { id: "s3", title: "Auth tokens", detail: "d3", files: ["a.ts"], branch: "auth" },
    { id: "s4", title: "Billing invoice", detail: "d4", files: ["b.ts"], branch: "billing" },
  ],
  branches: [
    { name: "auth", title: "Auth", scope: "logins", files: ["a.ts"], steps: ["s1", "s3"], dependsOn: [] },
    { name: "billing", title: "Billing", scope: "invoices", files: ["b.ts"], steps: ["s2", "s4"], dependsOn: ["auth"],
      subPlan: { prompt: "do billing stuff", steps: [] } },
  ],
};

// ── refine billing: s2 unchanged, s4 reworded, s5 added, s6 removed ─────────
const sub = {
  markdown: "## Billing sub-plan (refined)\n-steps here-",
  steps: [
    { id: "s2", title: "Billing table", detail: "d2", files: ["b.ts"], branch: null, }, // null branch must be allowed
    { id: "s4", title: "Billing invoice", detail: "d4-revised", files: ["b.ts", "c.ts"], branch: null }, // content change
    { id: "s5", title: "Stripe sync", detail: "d5", files: ["s.ts"], branch: null }, // added
    // "s3" collides with an auth branch step kept by the merge → must be re-id'd
    { id: "s3", title: "Echo collision", detail: "d6", files: [], branch: null },
  ],
};

const merged = mergeBranchRefine(meta as any, "billing", sub as any);

// global order preserved; billing steps moved in place
const ids = merged.steps.map((s) => s.id);
console.log("step order:", ids.join(","));
console.assert(ids[0] === "s1" && ids[5] === "s3", "auth steps untouched at positions");
console.assert(new Set(ids).size === ids.length, "no duplicate ids after merge");
console.assert(ids[4] !== "s3", "collision id re-id'd");

// billing branch record updated: titles + scoped markdown + subPlan steps kept
const billing = merged.branches.find((b) => b.name === "billing")!;
console.log("billing branch steps:", billing.steps.join(" | "));
console.assert(billing.markdown === sub.markdown, "scoped markdown recorded on branch");
console.assert(billing.subPlan?.prompt === "do billing stuff", "sub-plan prompt preserved");
console.assert((billing.subPlan?.steps?.length ?? 0) === 4, "subPlan steps replaced");

// auth branch byte-identical
const auth = merged.branches.find((b) => b.name === "auth")!;
console.assert(JSON.stringify(auth) === JSON.stringify(meta.branches[0]), "auth branch untouched");

// billing steps carry the forced branch name
console.assert(merged.steps.filter((s) => s.branch !== "billing").every((s) => s.branch === "auth"), "branch forcing");

// ── diff: id-based + title fallback ─────────────────────────────────────────
const oldSteps = meta.steps.filter((s) => s.branch === "billing");
const newSteps = merged.steps.filter((s) => s.branch === "billing");
const diff = diffBranchSteps(oldSteps as any, newSteps as any);
console.log("diff:", JSON.stringify({
  added: diff.added.map((s) => s.id),
  removed: diff.removed.map((s) => s.id),
  changed: diff.changed.map((c) => c.id),
}));
console.assert(JSON.stringify(diff.added.map((s) => s.id)) === JSON.stringify(["s5", "s6"]), "added (incl. re-id'd collision)");
console.assert(diff.removed.length === 0, "removed (collision re-id'd → it's an add)");
console.assert(diff.changed.length === 1 && diff.changed[0].id === "s4", "changed");

// id renames fall back to title matching
const renamed = diffBranchSteps(
  [{ id: "w1", title: "Same work", detail: "x", files: [] }, { id: "w2", title: "Other", detail: "y", files: [] }] as any,
  [{ id: "zz9", title: "Same work", detail: "x", files: [] }, { id: "w2", title: "Other", detail: "y", files: [] }] as any,
);
console.assert(renamed.changed.length === 1 && renamed.changed[0].id.startsWith("w1"), "title fallback promotes rename to changed");

// ── validateSubPlan ──────────────────────────────────────────────────────────
const bad = validateSubPlan({ steps: [] });
console.assert(bad.plan === null && bad.errors.length > 0, "empty steps rejected");
const wrongBranch = validateSubPlan({ markdown: "m", steps: [{ title: "t", detail: "d", files: [], branch: "other-branch" }] });
// an agent echoing a foreign branch name doesn't fail validation — merge forces it
console.assert(wrongBranch.plan !== null, "foreign branch name tolerated by validator (merge forces)");
console.assert(wrongBranch.plan!.steps[0].branch === "other-branch", "validator leaves branch as-is");

// ── scoped template mechanics: body + internalSuffix compose the full prompt ─
import { prompts } from "../lib/engine/prompts";
const vars = {
  branch: "billing", scope: "invoices", files: "b.ts", dependsOn: "auth",
  dependsOnSummaries: "- `auth` (Auth): logins", subPlanPrompt: "do billing stuff",
  currentSteps: "- s2: Billing table (1 files)", feedback: "FEEDBACK",
  context: "## Task context\nJira DEMO-142",
};
const full = prompts.resolve("plan_subplan_refine", {}, vars);
console.assert(!/\{\{(\w+)\}\}/.test(full), "no unresolved placeholders in full prompt");
console.assert(full.includes("FEEDBACK") && full.includes("Branch contract") && full.includes("s2: Billing table"), "vars rendered");
// internal suffix = full minus the rendered user body — same composition the planIsBody path uses at run time
const body = prompts.renderUserTemplate("plan_subplan_refine", vars);
const suffix = prompts.internalSuffix("plan_subplan_refine", vars);
console.assert(full.trim() === `${body}\n\n${suffix}`.trim(), "body + internalSuffix == full template");
console.assert(body.startsWith("Refine ONLY the sub-plan"), "body is the editable part");
console.assert(suffix.includes("Branch contract") && suffix.includes("Return a JSON object ONLY"), "suffix carries contract + JSON rules");

console.log("\nall merge/validate/template checks passed ✓");
