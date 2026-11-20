import "server-only";

import { resolveTemplate } from "../nodes/kinds/resolve/promptTemplate";
import { AgentOutputError } from "../nodes/shared/agent/outputError/outputErrorExports";
import {
  PLAN_TURN_OUTPUT_JSON_SCHEMA,
} from "../nodes/kinds/plan/schema";
import { REVIEW_COMMENTS_JSON_SCHEMA } from "../nodes/kinds/review/schema";

/**
 * The default prompt templates as an explicit three-part split:
 *
 *   1. `userTemplate` — the user-editable body (the prompt modal's textarea)
 *   2. rules blocks   — engine-authored behavioral rules (locked, shown in the
 *      modal's Rules section)
 *   3. output contract — the machine-parsed output-format block (locked, shown
 *      read-only in the modal's Output contract section)
 *
 * `data` blocks carry live run data (diffs, logs, comments, context packs).
 *
 * Node-owned templates (`resolve` today) live in the node's own folder —
 * `lib/engine/nodes/kinds/<node>/promptTemplate.ts` (AGENTS §2.3) — and are
 * registered here instead of defined inline, so each node's prompt stays
 * next to its code: `promptDefaults` is the registry, not the author.
 *
 * The blocks compose back to the exact strings that were hardcoded in the
 * pre-Phase-2 `nodes.ts` and carried verbatim through earlier phases:
 * `composeTemplate` joins body + blocks with blank lines. The pipeline_fix
 * composition is byte-identical to that string; review and resolve assemble
 * the body first (previously buried mid-template and DUPLICATED —
 * `internalSuffix`'s prefix-strip failed for them because the body placeholder
 * is not the template's first line). The plan-family and review output
 * contracts are NOT hand-authored: their contract blocks are the schema-
 * generated `AgentOutputError.directive()` (step 05) — the same text the run
 * path appends, so the advertised schema can never drift from the validator.
 */

export interface PromptBlock {
  /** "rules"/"contract" are engine-authored and locked; "data" is live run data. */
  kind: "rules" | "contract" | "data";
  /** static text — may carry {{vars}} rendered at run time */
  text: string;
}

export interface PromptTemplate {
  label: string;
  description: string;
  /**
   * The user-editable body shown in the prompt modal. Internal instructions
   * (rules, output contracts, run data) live in `internalBlocks` and are
   * appended automatically at run time.
   */
  userTemplate: string;
  /** Ordered internal blocks appended after the body at run time. */
  internalBlocks: PromptBlock[];
  variables: string[];
  mode: "agent" | "plan";
}

/** The full prompt string — body and internal blocks joined by blank lines. */
export function composeTemplate(tpl: PromptTemplate): string {
  return [tpl.userTemplate, ...tpl.internalBlocks.map((b) => b.text)]
    .filter((s) => s.length > 0)
    .join("\n\n");
}

export const DEFAULT_PROMPT_TEMPLATES: Record<string, PromptTemplate> = {
  plan: {
    label: "Simple plan",
    description:
      "Sent to the planning agent for a straightforward ticket — returns JSON with markdown + steps.",
    userTemplate: [
      `You are planning the implementation of a {{ticket_type}} ticket. Read the repository to ground the plan in the actual code.`,
      ``,
      `{{ticket}}`,
    ].join("\n"),
    internalBlocks: [
      { kind: "data", text: `{{context}}` },
      // the schema-generated directive (step 05) — byte-identical to the one
      // the plan retry prompt appends (PlanOutputContract.turnRetryPrompt)
      { kind: "contract", text: AgentOutputError.directive(PLAN_TURN_OUTPUT_JSON_SCHEMA) },
      {
        kind: "rules",
        text: [
          `Rules:`,
          `- "markdown" is the full plan document rendered to the user — be thorough and well-structured`,
          `- list the exact files to create/change and why, call out risks and edge cases, keep it scoped to the ticket`,
          `- "steps" is REQUIRED — a non-empty ordered array; each "id" must be a unique short string (s1, s2, …)`,
          `- each step "title" is a non-empty imperative sentence; "detail" is 1-2 sentences`,
          `- each step "files" lists the exact paths it touches; use [] when no files`,
          `- every step "branch" must be null (simple plans are single-branch)`,
          `- do NOT add any fields not listed above`,
          `- use at most one of plan, subPlan, subPlanPatch — on the first plan run use "plan" only when publishing`,
          `- you may reply without "plan" while clarifying — publish with "plan" when the checklist is ready`,
        ].join("\n"),
      },
    ],
    variables: ["ticket", "ticket_type", "feedback", "context"],
    mode: "plan",
  },
  plan_refine: {
    label: "Plan refinement",
    description:
      "Sent when a conversation message lands on the plan node (follow-up on the same agent): the response is always a reply, and carries the updated plan only when the message asks for one.",
    userTemplate: [
      `The conversation continues. The developer's latest message is:`,
      ``,
      `"""`,
      `{{feedback}}`,
      `"""`,
      ``,
      `{{context}}`,
      ``,
      `Answer the developer. If — and only if — the message asks for a change to the plan itself,`,
      `ALSO return the updated plan in the "plan" field of the output contract below.`,
      ``,
      `Rules:`,
      `- omit "plan" for questions, critiques, status requests — do NOT echo the plan back unchanged`,
      `- when "plan" IS present it must be the COMPLETE plan response — untouched branches are returned byte-identical; reuse existing step ids so unchanged`,
      `  steps keep their identity`,
      `- use at most one of plan, subPlan, subPlanPatch — whole-plan turns use "plan" only when publishing`,
      `- the "Current checklist" in your context may include developer hand edits — treat them as`,
      `  intent and preserve them unless the message changes them`,
    ].join("\n"),
    internalBlocks: [
      // the schema-generated directive (step 05) — the same PlanTurnOutput
      // contract the plan retry prompt re-states
      { kind: "contract", text: AgentOutputError.directive(PLAN_TURN_OUTPUT_JSON_SCHEMA) },
    ],
    variables: ["feedback", "context"],
    mode: "plan",
  },
  plan_subplan_refine: {
    label: "Sub-plan refinement (per branch)",
    description:
      "Sent when the developer refines ONE branch's sub-plan of a complex plan. Returns only that branch's sub-plan — other branches are untouched.",
    userTemplate: [
      `Refine ONLY the sub-plan for the branch \`{{branch}}\` of the implementation plan.`,
      ``,
      `## Developer feedback`,
      `"""`,
      `{{feedback}}`,
      `"""`,
      ``,
      `{{context}}`,
    ].join("\n"),
    internalBlocks: [
      {
        kind: "data",
        text: [
          `## Branch contract — do not change it`,
          `- scope: {{scope}}`,
          `- files: {{files}}`,
          `- depends on: {{dependsOn}}`,
          `{{dependsOnSummaries}}`,
        ].join("\n"),
      },
      {
        kind: "data",
        text: [
          `## Current sub-plan prompt`,
          `"""`,
          `{{subPlanPrompt}}`,
          `"""`,
        ].join("\n"),
      },
      { kind: "data", text: `## Current steps\n{{currentSteps}}` },
      // the schema-generated directive (step 05) — the same PlanTurnOutput
      // contract the plan retry prompt re-states on branch turns
      { kind: "contract", text: AgentOutputError.directive(PLAN_TURN_OUTPUT_JSON_SCHEMA) },
      {
        kind: "rules",
        text: [
          `Rules:`,
          `- your output replaces ONLY the \`{{branch}}\` sub-plan — other branches are planned elsewhere and your response must not affect them`,
          `- prefer "subPlanPatch" for small changes; use "subPlan" only for a full branch rewrite`,
          `- use at most one publish field — subPlanPatch or subPlan, never both`,
          `- never emit a whole "plan" object on branch turns`,
          `- the branch scope and file list above are the contract: keep the sub-plan inside them; if the feedback seems to require going outside the scope, keep the change minimal and say so in the first step's "detail"`,
          `- "steps" is REQUIRED — non-empty, ordered; unique short ids (s1, s2, …) — reuse the existing ids of unchanged steps so they keep their identity (the diff is id-based)`,
          `- each step "files" lists exact paths; reuse the current steps where they are still correct — don't rewrite what doesn't need to change`,
          `- the "Current steps" list may include developer hand edits — treat them as intent and preserve them unless the feedback changes them`,
          `- do NOT add any fields not listed above`,
        ].join("\n"),
      },
    ],
    variables: ["branch", "scope", "files", "dependsOn", "subPlanPrompt", "currentSteps", "feedback", "context"],
    mode: "plan",
  },
  build: {
    label: "Code changes",
    description:
      "Sent to the coding agent to implement the approved plan and push to a branch.",
    userTemplate: [
      `{{instructions}}`,
      ``,
      `{{ticket}}`,
      ``,
      `## Approved plan\n{{plan}}`,
      ``,
      `{{checklist}}`,
    ].join("\n"),
    internalBlocks: [],
    variables: ["ticket", "plan", "branch", "mode", "instructions", "checklist"],
    mode: "agent",
  },
  build_refine: {
    label: "Build refinement",
    description:
      "Sent when the developer requests changes to the build output (follow-up on the same agent).",
    userTemplate: [
      `The developer requested changes to your implementation:`,
      `"""\n{{feedback}}\n"""`,
      `Update the code accordingly, commit and push to the same branch.`,
    ].join("\n"),
    internalBlocks: [],
    variables: ["feedback"],
    mode: "agent",
  },
  step_build: {
    label: "Step build (fan-out child)",
    description:
      "Sent to the coding agent of a fan-out step child: implements exactly ONE plan step on its own branch, scoped by the context pack of sibling steps.",
    userTemplate: [
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
    internalBlocks: [],
    variables: ["ticket", "plan", "branch", "mode", "instructions", "step_section", "context_pack"],
    mode: "agent",
  },
  merge_fix: {
    label: "Merge-conflict fix (fan-out step child)",
    description:
      "Sent to a fan-out step child's agent when its step branch conflicts with (or is stale against) the integration branch, so it merges the integration branch into its own step branch and resolves the conflicts respecting both intents.",
    userTemplate: [
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
    internalBlocks: [],
    variables: ["branch", "integration", "situation", "error"],
    mode: "agent",
  },
  pipeline_fix: {
    label: "Pipeline fix",
    description:
      "Sent to the agent to diagnose and fix CI/CD pipeline failures on the MR branch.",
    userTemplate: `{{guidance}}`,
    internalBlocks: [
      {
        kind: "rules",
        text: [
          `The CI/CD pipeline #{{pipelineId}} failed on branch {{branch}}.`,
          `Fix the failures by committing and pushing fixes to the SAME branch ({{branch}}).`,
          `{{instructions}}`,
        ].join("\n"),
      },
      { kind: "data", text: `Failed job logs:\n{{logs}}` },
    ],
    variables: ["branch", "logs", "instructions", "guidance", "pipelineId"],
    mode: "agent",
  },
  review: {
    label: "AI review",
    description:
      "Sent to the review agent to analyse the MR diff and post inline comments.",
    userTemplate: `{{instructions}}`,
    internalBlocks: [
      {
        kind: "contract",
        text: [
          `You are a senior engineer reviewing a merge request for {{ticket_type}} {{ticket_key}}.`,
          `Review the diff below.`,
          `Only flag genuine issues (bugs, correctness, security, meaningful maintainability). If none, return [].`,
          ``,
          // the schema-generated directive (step 05) — the review response is
          // an ARRAY, so the directive carries the "array" shape
          AgentOutputError.directive(REVIEW_COMMENTS_JSON_SCHEMA, "array"),
        ].join("\n"),
      },
      { kind: "data", text: `Ticket context:\n{{ticket_summary}}\n\nPRD:\n{{ticket_prd}}` },
      { kind: "data", text: `Diff:\n{{diff}}` },
    ],
    variables: ["ticket_key", "ticket_type", "ticket_summary", "ticket_prd", "diff", "instructions"],
    mode: "agent",
  },
  resolve: resolveTemplate,
};
