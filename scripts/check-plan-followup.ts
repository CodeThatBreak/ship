/**
 * Phase-1 checks for the plan conversation follow-up contract
 * (docs/plan-conversation-refine.md): the plan_refine template composition,
 * the §1 parse matrix, and the §6c refinedFrom provenance shapes that the
 * persist sites must record.
 *
 * Run (plain tsx needs a `server-only` stub on the resolution path — the same
 * shim check-prompt-splits' compile flow uses):
 *   mkdir -p node_modules/.cache/promptcheck/shims/server-only
 *   printf 'module.exports = {};' > node_modules/.cache/promptcheck/shims/server-only/index.js
 *   printf '{"name":"server-only","main":"index.js"}' > node_modules/.cache/promptcheck/shims/server-only/package.json
 *   NODE_PATH="$PWD/node_modules/.cache/promptcheck/shims" \
 *     npx tsx scripts/check-plan-followup.ts
 */
import { prompts } from "../lib/engine/prompts/prompt-library";
import { DEFAULT_PROMPT_TEMPLATES } from "../lib/engine/prompts/prompt-defaults";
import { parseFollowUp } from "../lib/engine/nodes/kinds/plan/plan-followup";
import { PlanResponse } from "../lib/engine/nodes/kinds/plan/schema";
import type { RefinedFrom } from "../lib/engine/nodes/kinds/plan/constants/refine";

let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

// ── 1. the plan_refine conversation contract composes cleanly (§2) ───────────
const full = prompts.resolve("plan_refine", {}, { feedback: "FEEDBACK-MSG", context: "CONTEXT-DOC" }, undefined, {
  userRules: "USER-RULES",
});
check("plan_refine renders without unresolved {{…}}", !/\{\{(\w+)\}\}/.test(full));
check("plan_refine carries the developer message", full.includes("FEEDBACK-MSG"));
check("plan_refine carries the context document", full.includes("CONTEXT-DOC"));
check("plan_refine carries the user rules", full.includes("USER-RULES"));
check("plan_refine body is the conversation contract", full.startsWith("The conversation continues."));
check("plan_refine body carries the follow-up shape", full.includes('"reply"') && full.includes('"plan"'));
check("plan_refine body carries the hand-edit rule", full.includes("developer hand edits"));

// the template is body-only: internal suffix is empty, body + suffix == full
check(
  "plan_refine internalSuffix is empty (body-only template)",
  prompts.internalSuffix("plan_refine", {}, { feedback: "F", context: "C" }).trim() === ""
);
// renderUserTemplate = the editable body (the composer's prefill in Phase 2);
// body + rules suffix composes back to the run path's `final`
const body = prompts.renderUserTemplate(
  "plan_refine",
  {},
  { feedback: "FEEDBACK-MSG", context: "CONTEXT-DOC" }
);
check(
  "renderUserTemplate + userRules composes back to the assembled final",
  full === [body, "USER-RULES"].filter(Boolean).join("\n\n")
);

// the DEFAULT template variables stay stable (parity fixtures depend on them)
check(
  "plan_refine variables are exactly feedback + context",
  JSON.stringify(DEFAULT_PROMPT_TEMPLATES.plan_refine.variables) === JSON.stringify(["feedback", "context"])
);
check("plan_refine stays a body-only template", DEFAULT_PROMPT_TEMPLATES.plan_refine.internalBlocks.length === 0);
check("plan_refine plan defaults mode unchanged", DEFAULT_PROMPT_TEMPLATES.plan_refine.mode === "plan");
// the base plan template is untouched by this phase
check(
  "the base plan template body is unchanged",
  DEFAULT_PROMPT_TEMPLATES.plan.userTemplate.startsWith(
    "You are planning the implementation of a {{ticket_type}} ticket"
  )
);

// ── 2. the §1 parse matrix ───────────────────────────────────────────────────
const step = (id: string, title: string) => ({ id, title, detail: "d", files: ["f.ts"], branch: null });
const goodPlan = { markdown: "# Plan", steps: [step("s1", "First"), step("s2", "Second")] };
const invalidPlan = { markdown: "# Plan", steps: [step("s1", "First"), step("s1", "Again")] };

// (identity is per-JSON-round-trip: extractJson re-parses, so payload equality
// is asserted on JSON, not object identity)
const eqPlan = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

let turn = parseFollowUp(JSON.stringify({ reply: "Answered.", plan: goodPlan }));
check("full envelope → reply + plan rides through (validated at the apply)", turn.reply === "Answered." && eqPlan(turn.plan, goodPlan));

turn = parseFollowUp(JSON.stringify({ reply: "Answered.", plan: null }));
check("explicit plan:null → reply-only", turn.reply === "Answered." && turn.plan === null);

turn = parseFollowUp(JSON.stringify({ reply: "Answered." }));
check("omitted plan → reply-only (same kind)", turn.reply === "Answered." && turn.plan === null);

turn = parseFollowUp(JSON.stringify(goodPlan));
check("bare plan (envelope dropped) → plan-only, reply defaults", turn.reply === "Plan updated." && eqPlan(turn.plan, goodPlan));

turn = parseFollowUp(JSON.stringify({ plan: goodPlan }));
check("missing reply with a plan → plan wins", turn.reply === "Plan updated." && eqPlan(turn.plan, goodPlan));

const prose = "Sure — here is where things stand: step 2 is blocked on the migration.";
turn = parseFollowUp(prose);
check("free-form output is NEVER a plan — the raw text is the reply", turn.reply === prose && turn.plan === null);

turn = parseFollowUp(JSON.stringify({ reply: "Done.", plan: invalidPlan }));
check(
  "an envelope with an INVALID plan is still plan-bearing (reaches the §3c bounded retry, not a silent reply-only)",
  eqPlan(turn.plan, invalidPlan)
);

turn = parseFollowUp("");
check("an empty run result stays reply-only", turn.plan === null && turn.reply === "");

// the schema's superRefinements reject the invalid payload (the messages the
// apply's AgentOutputError carries for the retry feedback)
check(
  "PlanResponse still rejects duplicate step ids with the load-bearing message",
  !PlanResponse.safeParse(invalidPlan).success
);

// ── 3. §6c refinedFrom provenance — the meta shape the persist sites write ──
// PlanStore.persistPlan's `refined` arg lands verbatim as meta.refinedFrom;
// "a version with refinedFrom" == "a produced refine". Shape expectations:
const provenance: RefinedFrom = { version: 2, source: "chat" };
const meta: Record<string, unknown> = { feedback: "msg", refinedFrom: provenance, execution: "whole" };
check("meta.refinedFrom records the version the refine was BASED on", (meta.refinedFrom as RefinedFrom).version === 2);
check("refinedFrom.source is the closed union", ["chat", "branch", "start"].includes((meta.refinedFrom as RefinedFrom).source));
const replyOnlyMeta: Record<string, unknown> = { feedback: "message" };
check("a reply-only turn persists NO refinedFrom", replyOnlyMeta.refinedFrom === undefined);
const firstApply: RefinedFrom = { version: 0, source: "chat" };
check("a first apply (no version yet) records version 0", firstApply.version === 0);

console.log(failed > 0 ? `\n${failed} check(s) failed` : "\nall plan follow-up checks passed ✓");
if (failed > 0) process.exit(1);
