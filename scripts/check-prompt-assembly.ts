/**
 * Run-time assembly checks for the three-part prompt split:
 *  1. the default plan assembly (assemblePrompt) renders byte-identically to
 *     the pre-refactor path (render the full template + internalSuffix body-strip)
 *  2. the review/resolve/pipeline_fix body is no longer duplicated mid-prompt
 *     (the old prefix-strip failed for them)
 *  3. the `prompt_rules` config knob lands between the body and the locked blocks
 *
 * Run (then run the emitted JS — same steps as check-prompt-splits.ts):
 *   npx tsc scripts/check-prompt-assembly.ts --outDir node_modules/.cache/promptcheck \
 *     --module commonjs --moduleResolution node --target es2022 --skipLibCheck \
 *     --esModuleInterop --strict
 *   node node_modules/.cache/promptcheck/scripts/check-prompt-assembly.js
 */
import { prompts } from "../lib/engine/prompts/prompt-library";

let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

// ── 1. plan: new assembly == old render+strip ────────────────────────────────
const planCtx = { ticket: "TICKET-CTX", ticket_type: "bug" };
const extra = { context: "## Context\nCONTEXT-BLOCK" };

// the pre-refactor algorithm, inlined verbatim against the original template
const OLD_PLAN_TEMPLATE = [
  `You are planning the implementation of a {{ticket_type}} ticket. Read the repository to ground the plan in the actual code.`,
  ``,
  `{{ticket}}`,
  ``,
  `{{context}}`,
  ``,
  `Return a JSON object ONLY — no prose before or after, no code fences. The JSON must match this exact schema:`,
  `{`,
  `  "markdown": "<the full implementation plan in Markdown — this is what the user sees>",`,
  `  "steps": [{"id":"s1","title":"Short imperative title","detail":"What to change and why","files":["path/to/file.ts"],"branch":null}]`,
  `}`,
  ``,
  `Rules:`,
  `- "markdown" is the full plan document rendered to the user — be thorough and well-structured`,
  `- list the exact files to create/change and why, call out risks and edge cases, keep it scoped to the ticket`,
  `- "steps" is REQUIRED — a non-empty ordered array; each "id" must be a unique short string (s1, s2, …)`,
  `- each step "title" is a non-empty imperative sentence; "detail" is 1-2 sentences`,
  `- each step "files" lists the exact paths it touches; use [] when no files`,
  `- every step "branch" must be null (simple plans are single-branch)`,
  `- do NOT add any fields not listed above`,
  `- your entire response must be parseable as a single JSON object`,
].join("\n");
const render = (t: string, vars: Record<string, string | undefined>) =>
  t.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? "");
const oldBody = render(prompts.renderUserTemplate("plan", planCtx, extra), planCtx).trim();
const oldSuffix = (() => {
  let suffix = render(OLD_PLAN_TEMPLATE, { ...planCtx, ...extra }).trim();
  if (oldBody && suffix.startsWith(oldBody)) suffix = suffix.slice(oldBody.length).trim();
  return suffix;
})();
const oldFinal = `${oldBody}\n\n${oldSuffix}`;
const newFinal = prompts.resolve("plan", planCtx, extra);
check("plan: default assembly == pre-refactor render+strip", newFinal === oldFinal,
  `\n--old--\n${oldFinal}\n--new--\n${newFinal}`);

// ── 2. review: body placeholder appears exactly once ─────────────────────────
const reviewFinal = prompts.resolve("review", { ticket_key: "T-1", ticket_type: "bug" },
  { instructions: "INSTRUCTIONS-BODY", diff: "DIFF-BLOCK" });
check("review: instructions appear once", (reviewFinal.match(/INSTRUCTIONS-BODY/g) ?? []).length === 1, reviewFinal);
check("review: body first, contract then run data",
  reviewFinal.startsWith("INSTRUCTIONS-BODY\n\n") && reviewFinal.indexOf("You are a senior engineer") > 0
    && reviewFinal.indexOf("DIFF-BLOCK") > reviewFinal.indexOf("You are a senior engineer"), reviewFinal);

// ── 3. prompt_rules lands between the body and the locked blocks ─────────────
const asm = prompts.assemblePrompt("plan", planCtx, extra, { userRules: "MY-STANDING-RULE" });
check("plan: user rules between body and engine blocks",
  asm.final.startsWith(`${asm.body}\n\nMY-STANDING-RULE\n\n`) && asm.final.includes("Rules:"), asm.final);
check("plan: assembly exposes the three parts",
  asm.userRules === "MY-STANDING-RULE" && asm.body.length > 0 && asm.blocks.length === 3);

// ── 4. build: verbatim override + standing rules ─────────────────────────────
const buildFinal = prompts.resolve("build", {}, {}, "MY-VERBATIM-OVERRIDE", { userRules: "MY-STANDING-RULE" });
check("build: override kept verbatim with rules appended", buildFinal === "MY-VERBATIM-OVERRIDE\n\nMY-STANDING-RULE", buildFinal);

if (failed > 0) {
  console.error(`\n${failed} assembly check(s) failed`);
  process.exit(1);
}
console.log("\nAll prompt assembly checks passed.");
