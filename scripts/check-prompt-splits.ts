/* Zero-behavior-change check: the split prompt templates must compose back to
 * the pre-refactor verbatim strings. Run (then run the emitted JS):
 *   npx tsc scripts/check-prompt-splits.ts --outDir node_modules/.cache/promptcheck \
 *     --module commonjs --moduleResolution node --target es2022 --skipLibCheck \
 *     --esModuleInterop --strict
 *   node node_modules/.cache/promptcheck/scripts/check-prompt-splits.js
 * Review/resolve/pipeline_fix EXPECT to differ — the old assembly duplicated
 * the body placeholder mid-template (the internalSuffix prefix-strip failed
 * because the body wasn't the first line); the composed version assembles the
 * body once, first. */
import { DEFAULT_PROMPT_TEMPLATES, composeTemplate } from "../lib/engine/prompts/prompt-defaults";

const ORIGINALS: Record<string, string> = {
  plan: [
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
  ].join("\n"),
  plan_refine: [
    `The conversation continues. The developer's latest message is:`,
    ``,
    `"""`,
    `{{feedback}}`,
    `"""`,
    ``,
    `{{context}}`,
    ``,
    `Answer the developer. If — and only if — the message asks for a change to the plan itself,`,
    `ALSO return the updated plan. Return a single JSON object only (no prose, no code fences):`,
    ``,
    `{`,
    `  "reply": "<what you did or answered, in plain text for the developer>",`,
    `  "plan": { "markdown": "...", "steps": [...], "branches": [...] }   // omit entirely when not changing the plan`,
    `}`,
    ``,
    `Rules:`,
    `- omit "plan" for questions, critiques, status requests — do NOT echo the plan back unchanged`,
    `- when "plan" IS present it must be the COMPLETE plan response (the full schema, contract`,
    `  below) — untouched branches are returned byte-identical; reuse existing step ids so unchanged`,
    `  steps keep their identity`,
    `- the "Current checklist" in your context may include developer hand edits — treat them as`,
    `  intent and preserve them unless the message changes them`,
  ].join("\n"),
  plan_subplan_refine: [
    `Refine ONLY the sub-plan for the branch \`{{branch}}\` of the implementation plan.`,
    ``,
    `## Developer feedback`,
    `"""`,
    `{{feedback}}`,
    `"""`,
    ``,
    `{{context}}`,
    ``,
    `## Branch contract — do not change it`,
    `- scope: {{scope}}`,
    `- files: {{files}}`,
    `- depends on: {{dependsOn}}`,
    `{{dependsOnSummaries}}`,
    ``,
    `## Current sub-plan prompt`,
    `"""`,
    `{{subPlanPrompt}}`,
    `"""`,
    ``,
    `## Current steps`,
    `{{currentSteps}}`,
    ``,
    `Return a JSON object ONLY — no prose before or after, no code fences. The JSON must match:`,
    `{`,
    `  "markdown": "<this branch's implementation detail in Markdown>",`,
    `  "steps": [{"id":"s1","title":"Short imperative title","detail":"What to change and why","files":["path/to/file.ts"]}]`,
    `}`,
    ``,
    `Rules:`,
    `- your output replaces ONLY the \`{{branch}}\` sub-plan — other branches are planned elsewhere and your response must not affect them`,
    `- the branch scope and file list above are the contract: keep the sub-plan inside them; if the feedback seems to require going outside the scope, keep the change minimal and say so in the first step's "detail"`,
    `- "steps" is REQUIRED — non-empty, ordered; unique short ids (s1, s2, …) — reuse the existing ids of unchanged steps so they keep their identity (the diff is id-based)`,
    `- each step "files" lists exact paths; reuse the current steps where they are still correct — don't rewrite what doesn't need to change`,
    `- the "Current steps" list may include developer hand edits — treat them as intent and preserve them unless the feedback changes them`,
    `- do NOT add any fields not listed above`,
    `- your entire response must be parseable as a single JSON object`,
  ].join("\n"),
  build: [
    `{{instructions}}`,
    ``,
    `{{ticket}}`,
    ``,
    `## Approved plan\n{{plan}}`,
    ``,
    `{{checklist}}`,
  ].join("\n"),
  build_refine: [
    `The developer requested changes to your implementation:`,
    `"""\n{{feedback}}\n"""`,
    `Update the code accordingly, commit and push to the same branch.`,
  ].join("\n"),
  step_build: [
    `{{instructions}}`,
    ``,
    `{{ticket}}`,
    ``,
    `## Approved plan\n{{plan}}`,
    ``,
    `## Your step — implement exactly this step`,
    `{{step_section}}`,
    ``,
    `## Sibling steps (other agents build them in parallel)`,
    `{{context_pack}}`,
  ].join("\n"),
  commit_fix: [
    `Committing or pushing branch {{branch}} failed with the error below.`,
    `Fix the underlying problem in the code, then commit and push to the SAME branch ({{branch}}).`,
    `Do NOT open a merge request.`,
    `{{instructions}}`,
    ``,
    `Error:\n{{error}}`,
  ].join("\n"),
  merge_fix: [
    `Your step branch {{branch}} has to be landed on the integration branch {{integration}}, but it is {{situation}}.`,
    ``,
    `Repair this ON YOUR OWN STEP BRANCH {{branch}} (never rebase, never push to {{integration}}, never force-push):`,
    `1. \`git fetch origin\``,
    `2. \`git merge origin/{{integration}}\` — conflicts (or a diverged history) are expected here`,
    `3. Resolve every conflict respecting BOTH intents: your step's changes AND the sibling code already landed on {{integration}}. Keep the sibling code intact and working; re-apply your step's intent on top of it. Do NOT delete or weaken sibling changes to make your merge trivial.`,
    `4. Sanity-check the combined result (compile/typecheck/tests where the repo supports it)`,
    `5. Commit the merge and push your step branch: \`git push origin {{branch}}\``,
    `Do NOT open a merge request.`,
    `When done, briefly summarise how each conflict was resolved.`,
    ``,
    `Merge output / conflicts:\n{{error}}`,
  ].join("\n"),
  pipeline_fix: [
    `The CI/CD pipeline #{{pipelineId}} failed on branch {{branch}}.`,
    `Fix the failures by committing and pushing fixes to the SAME branch ({{branch}}).`,
    `{{instructions}}`,
    `{{guidance}}`,
    `Failed job logs:\n{{logs}}`,
  ].join("\n"),
  review: [
    `You are a senior engineer reviewing a merge request for {{ticket_type}} {{ticket_key}}.`,
    `Review the diff below. Return a JSON array ONLY, no prose, of inline comments:`,
    `[{"file": "path", "line": <new-file line number>, "body": "comment"}]`,
    `Only flag genuine issues (bugs, correctness, security, meaningful maintainability). If none, return [].`,
    `{{instructions}}`,
    ``,
    `Ticket context:\n{{ticket_summary}}\n\nPRD:\n{{ticket_prd}}`,
    ``,
    `Diff:\n{{diff}}`,
  ].join("\n"),
  resolve: [
    `{{header}}`,
    `{{subheader}}`,
    `{{instructions}}`,
    `{{dev_instructions}}`,
    ``,
    `{{comments}}`,
  ].join("\n"),
};

/** The old assembly duplicated the body mid-template for these keys
 *  (internalSuffix's prefix-strip failed) — the composed version fixes it, so
 *  they intentionally differ. */
const EXPECTED_DIFF = new Set(["review", "resolve", "pipeline_fix"]);

let failed = 0;
for (const [key, tpl] of Object.entries(DEFAULT_PROMPT_TEMPLATES)) {
  const original = ORIGINALS[key];
  if (original == null) {
    console.error(`✗ ${key}: no original recorded`);
    failed++;
    continue;
  }
  const composed = composeTemplate(tpl);
  if (composed === original) {
    console.log(`✓ ${key} byte-identical`);
    continue;
  }
  if (EXPECTED_DIFF.has(key)) {
    const count = (s: string) => (composed.match(new RegExp(escape(s), "g")) ?? []).length;
    const bodyVar = tpl.userTemplate.trim();
    if (count(bodyVar) === 1) {
      console.log(`✓ ${key} differs as expected (body assembled once, first — duplication removed)`);
      continue;
    }
    console.error(`✗ ${key}: composed differs AND body count != 1`);
    failed++;
    continue;
  }
  console.error(`✗ ${key}: composed != original`);
  console.error("  expected:", JSON.stringify(original));
  console.error("  actual:  ", JSON.stringify(composed));
  failed++;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (failed > 0) {
  console.error(`\n${failed} template(s) failed the composition check`);
  process.exit(1);
}
console.log("\nAll prompt templates compose correctly.");
