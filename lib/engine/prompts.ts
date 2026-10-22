import { db } from "../db";
import { NODE_KEYS } from "./nodes/keys";

export interface PromptTemplate {
  label: string;
  description: string;
  template: string;
  /**
   * The user-editable body shown in the prompt modal. Internal instructions
   * (output-format contracts, workflow rules the code depends on) are omitted
   * here and re-appended automatically at run time — see `internalSuffix`.
   */
  userTemplate?: string;
  variables: string[];
  mode: "agent" | "plan";
}

export type PromptCtx = Record<string, string | undefined>;

/**
 * Default templates — verbatim copies of the strings that were hardcoded in
 * nodes.ts before Phase 2.  Do NOT change these without a migration plan:
 * they are the zero-behavior-change guarantee.
 */
const DEFAULTS: Record<string, PromptTemplate> = {
  plan: {
    label: "Implementation plan",
    description:
      "Sent to the planning agent to produce a step-by-step implementation plan from the Jira ticket.",
    template: [
      `You are planning the implementation of a Jira ticket. Read the repository to ground the plan in the actual code.`,
      ``,
      `{{ticket}}`,
      ``,
      `Produce a concrete, step-by-step implementation plan in Markdown:`,
      `- list the exact files to create/change and why`,
      `- call out risks, edge cases, and how to test`,
      `- keep it scoped to the ticket`,
      ``,
      `ALWAYS end your response with a \`\`\`json plan-meta\`\`\` block — a machine-readable checklist of the work:`,
      `\`\`\`json plan-meta`,
      `{"steps":[{"id":"s1","title":"Short imperative title","detail":"What to change and why","files":["path/to/file.ts"],"branch":null}],"branches":[]}`,
      `\`\`\``,
      `Rules:`,
      `- steps are the full ordered checklist of the work; keep ids short, stable and unique (s1, s2, …)`,
      `- each step lists the exact files it touches; detail is 1-2 sentences`,
      `- if the work decomposes into independent branches (e.g. backend + frontend, or per-module), also fill "branches":`,
      `  [{"name":"slug-safe-name","title":"Short title","scope":"What this branch covers","files":["path/to/file1.ts"],"steps":["step 1","step 2"],"dependsOn":[]}]`,
      `  and set each step's "branch" to the owning branch name. Branch names must be lowercase alphanumeric + hyphens, unique;`,
      `  dependsOn lists branch names that must build first.`,
      `- for a single cohesive change, omit "branches" (or use []) and leave every step's "branch" null.`,
    ].join("\n"),
    userTemplate: [
      `You are planning the implementation of a Jira ticket. Read the repository to ground the plan in the actual code.`,
      ``,
      `{{ticket}}`,
    ].join("\n"),
    variables: ["ticket", "feedback"],
    mode: "plan",
  },
  plan_refine: {
    label: "Plan refinement",
    description:
      "Sent when the developer provides feedback to refine an existing plan (follow-up on the same agent).",
    template: [
      `Refine the implementation plan based on this feedback:`,
      `"""\n{{feedback}}\n"""`,
      `Keep it grounded in the repo. Output the full revised plan in Markdown,`,
      `and re-emit the full \`\`\`json plan-meta\`\`\` block (same format as before, updated to match the revised plan).`,
    ].join("\n"),
    variables: ["feedback"],
    mode: "plan",
  },
  build: {
    label: "Code changes",
    description:
      "Sent to the coding agent to implement the approved plan and push to a branch.",
    template: [
      `{{instructions}}`,
      ``,
      `{{ticket}}`,
      ``,
      `## Approved plan\n{{plan}}`,
      ``,
      `{{checklist}}`,
    ].join("\n"),
    variables: ["ticket", "plan", "branch", "mode", "instructions", "checklist"],
    mode: "agent",
  },
  build_refine: {
    label: "Build refinement",
    description:
      "Sent when the developer requests changes to the build output (follow-up on the same agent).",
    template: [
      `The developer requested changes to your implementation:`,
      `"""\n{{feedback}}\n"""`,
      `Update the code accordingly, commit and push to the same branch.`,
    ].join("\n"),
    variables: ["feedback"],
    mode: "agent",
  },
  commit_fix: {
    label: "Commit/push fix",
    description:
      "Sent to the build agent when committing or pushing the build branch failed (e.g. a pre-push hook type check) so it fixes the code and re-pushes.",
    template: [
      `Committing or pushing branch {{branch}} failed with the error below.`,
      `Fix the underlying problem in the code, then commit and push to the SAME branch ({{branch}}).`,
      `Do NOT open a merge request.`,
      `{{instructions}}`,
      ``,
      `Error:\n{{error}}`,
    ].join("\n"),
    variables: ["branch", "error", "instructions"],
    mode: "agent",
  },
  pipeline_fix: {
    label: "Pipeline fix",
    description:
      "Sent to the agent to diagnose and fix CI/CD pipeline failures on the MR branch.",
    template: [
      `The CI/CD pipeline #{{pipelineId}} failed on branch {{branch}}.`,
      `Fix the failures by committing and pushing fixes to the SAME branch ({{branch}}).`,
      `{{instructions}}`,
      `{{guidance}}`,
      `Failed job logs:\n{{logs}}`,
    ].join("\n"),
    userTemplate: `{{guidance}}`,
    variables: ["branch", "logs", "instructions", "guidance", "pipelineId"],
    mode: "agent",
  },
  review: {
    label: "AI review",
    description:
      "Sent to the review agent to analyse the MR diff and post inline comments.",
    template: [
      `You are a senior engineer reviewing a merge request for Jira {{ticket_key}}.`,
      `Review the diff below. Return a JSON array ONLY, no prose, of inline comments:`,
      `[{"file": "path", "line": <new-file line number>, "body": "comment"}]`,
      `Only flag genuine issues (bugs, correctness, security, meaningful maintainability). If none, return [].`,
      `{{instructions}}`,
      ``,
      `Ticket context:\n{{ticket_summary}}\n\nPRD:\n{{ticket_prd}}`,
      ``,
      `Diff:\n{{diff}}`,
    ].join("\n"),
    userTemplate: `{{instructions}}`,
    variables: ["ticket_key", "ticket_summary", "ticket_prd", "diff", "instructions"],
    mode: "agent",
  },
  resolve: {
    label: "Comment resolution",
    description:
      "Sent to the agent to address open MR review comments by committing fixes.",
    template: [
      `{{header}}`,
      `{{subheader}}`,
      `{{instructions}}`,
      `{{dev_instructions}}`,
      ``,
      `{{comments}}`,
    ].join("\n"),
    userTemplate: `{{dev_instructions}}`,
    variables: ["branch", "comments", "instructions", "mode", "header", "subheader", "dev_instructions"],
    mode: "agent",
  },
};

/**
 * The library of prompt templates: hardcoded defaults overlaid with
 * user-customized templates from settings, plus `{{var}}` rendering.
 */
export class PromptLibrary {
  /** All registered node keys (including sub-keys like plan_refine). */
  static readonly NODE_KEYS = Object.keys(DEFAULTS);

  /** Top-level template keys shown on the settings page (excludes _refine variants).
   *  "pipeline_fix" is the fix-run template used by the pipeline gate node. */
  static readonly TOP_LEVEL_KEYS: string[] = [
    NODE_KEYS.PLAN,
    NODE_KEYS.BUILD,
    "pipeline_fix",
    NODE_KEYS.REVIEW,
    NODE_KEYS.RESOLVE,
  ];

  /**
   * Return the effective template for a node key. If the user has saved a
   * custom template in settings, it wins; otherwise the hardcoded default.
   */
  getTemplate(nodeKey: string): PromptTemplate {
    const custom = db.getSetting<Record<string, PromptTemplate>>(`prompt_templates`, {});
    if (custom[nodeKey]?.template) {
      return { ...DEFAULTS[nodeKey], ...custom[nodeKey] };
    }
    return DEFAULTS[nodeKey];
  }

  /** Return all templates (custom-overlaid) for the settings page. */
  allTemplates(): Record<string, PromptTemplate> {
    const custom = db.getSetting<Record<string, PromptTemplate>>(`prompt_templates`, {});
    const out: Record<string, PromptTemplate> = {};
    for (const key of PromptLibrary.TOP_LEVEL_KEYS) {
      out[key] = custom[key]?.template ? { ...DEFAULTS[key], ...custom[key] } : DEFAULTS[key];
    }
    return out;
  }

  /**
   * Render a template string with the given context.
   * `{{var}}` placeholders are replaced by `ctx[var] ?? ""`.
   */
  private render(template: string, ctx: PromptCtx): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => ctx[name] ?? "");
  }

  /**
   * The user-editable body of a template: what the prompt modal shows and lets
   * the user edit. Internal instructions (see `internalSuffix`) are stripped —
   * they are re-appended automatically at run time, so users can't break the
   * output contracts the code parses. Nodes without a `userTemplate` return
   * the full template unchanged.
   */
  renderUserTemplate(nodeKey: string, ctx: PromptCtx, extra?: PromptCtx): string {
    const tpl = this.getTemplate(nodeKey);
    const body = tpl.userTemplate ?? tpl.template;
    return this.render(body, { ...ctx, ...extra }).trim();
  }

  /**
   * The internal-instruction block that must follow the user-editable body at
   * run time. Computed from the DEFAULT template (not the user-customized one)
   * so custom templates can't lose the contracts the code depends on.
   * Returns "" for nodes without a separate userTemplate.
   */
  internalSuffix(nodeKey: string, ctx: PromptCtx, extra?: PromptCtx): string {
    const def = DEFAULTS[nodeKey];
    if (!def?.userTemplate) return "";
    const vars = { ...ctx, ...extra };
    const body = this.render(def.userTemplate, vars).trim();
    let suffix = this.render(def.template, vars).trim();
    if (body && suffix.startsWith(body)) suffix = suffix.slice(body.length).trim();
    return suffix;
  }

  /**
   * Resolve the prompt for a node run.
   *
   * @param nodeKey  e.g. "plan", "build", "pipeline_fix", "review", "resolve"
   * @param ctx      base context variables (ticket, branch, mode, …)
   * @param extra    per-run extras (feedback, instructions, plan, diff, logs, comments, …)
   * @param override verbatim prompt that bypasses the template entirely
   */
  resolve(
    nodeKey: string,
    ctx: PromptCtx,
    extra?: PromptCtx,
    override?: string | null,
  ): string {
    if (override) return override;
    const vars = { ...ctx, ...extra };
    const tpl = this.getTemplate(nodeKey);
    return this.render(tpl.template, vars);
  }

  /** Validate that a node key is known. */
  isValidNodeKey(key: string): boolean {
    return key in DEFAULTS;
  }
}

export const prompts = new PromptLibrary();
