import "server-only";

import { prompts } from "../../../prompts/promptLibrary";
import { untrustedData } from "../../../prompts/untrustedData";
import { planSteps } from "../../../runtime/planStepStore";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import type { FlowContextHelper, FlowCtx } from "../../shared/nodeSharedExports";
import { BuildRunSupport } from "./buildRunSupport";
import type { BuildBranchInfo } from "./schema";

/**
 * BuildPromptAssembler — the build kind's ONE prompt assembly path
 * (coding-patterns §3.11, the `<kind>-prompt` slot): the branch name,
 * instruction text, plan/checklist blocks and resolve/assemble route shared
 * by `run` and `previewPrompt`, so the preview cannot drift from the prompt
 * a run actually sends (CR-004).
 *
 * Invariants: the approved plan is authored by a previous agent run — it is
 * untrusted data and goes through `untrustedData()` fenced (no cap exists
 * today; none added); the checklist block advertises `claim_checklist_progress`
 * as the authoritative progress path with the prose fence as the logged
 * fallback (step 08); a first-turn body (`promptIsBody`) is resolved as the
 * FULL edited body — the build template is body-only, so plan, checklist and
 * instructions all render inside the body and a light edit keeps them.
 *
 * Must never: grow a second assembly path for run vs preview, or cap/trim
 * the plan silently.
 */
export class BuildPromptAssembler {
  constructor(
    private readonly buildRun: BuildRunSupport,
    private readonly ctxHelper: FlowContextHelper,
  ) {}

  /**
   * Shared build prompt assembly for `run` and `previewPrompt` — one branch
   * name, instruction text, checklist block, and resolve/assemble path.
   */
  async assemble(
    ctx: FlowCtx,
    config: Record<string, unknown>,
    args: {
      /** the approved plan content; null renders the "(no plan yet)" placeholder */
      plan: string | null;
      branchInfo: BuildBranchInfo | null;
      promptOverride: string | null;
      promptIsBody?: boolean;
      setupNote: string | null;
    },
  ): Promise<{ configBody: string | null; assembly: ReturnType<typeof prompts.assemblePrompt> }> {
    const branchSuffix = args.branchInfo?.name;
    const branch = this.buildRun.branchName(ctx, config, branchSuffix);
    const mode = this.ctxHelper.execMode(ctx);

    // the approved plan is authored by a previous agent run — untrusted data,
    // fenced (no cap exists today; none added)
    const planBlock = args.plan
      ? untrustedData({ source: "approved plan", text: args.plan }).text
      : "(no plan yet)";
    let scopedPlan = planBlock;
    if (args.branchInfo?.scope) {
      scopedPlan = `Branch scope: ${args.branchInfo.scope}\n\n${planBlock}`;
    }

    const ticketType = this.ctxHelper.taskLabel(ctx);
    let instructions = mode === "local"
      ? `Implement the following approved plan for a ${ticketType} ticket. Your working directory is a git worktree already checked out on branch "${branch}" (fresh off the repo's default branch). Make the code changes, commit them to that branch, and push the branch to origin. Do NOT open a merge request, do not switch branches, and do not touch any checkout outside this directory.`
      : `Implement the following approved plan for a ${ticketType} ticket. Make the code changes, commit them, and push to a feature branch. Do NOT open a merge request yet.`;
    instructions += this.buildRun.setupAdvisory(args.setupNote);

    const checklistRows = await planSteps.markdown(ctx.flow.id, args.branchInfo?.name ?? null);
    const checklist = checklistRows
      ? [
          `## Plan checklist`,
          `Work through these steps (ids in brackets):`,
          checklistRows,
          ``,
          `When you finish, report the ids of the steps you fully completed — prefer the claim_checklist_progress API (see Tools available); the prose fence is also accepted as a fallback:`,
          `\`\`\`json build-progress`,
          `{"completed":["s1","s2"]}`,
          `\`\`\``,
        ].join("\n")
      : "";

    const configBody = args.promptOverride;
    if (configBody) {
      if (args.promptIsBody) {
        // chat first turn: the message is the full edited body — the same
        // resolution the verbatim `prompt_body` config knob produces (the
        // build template is body-only: plan, checklist and instructions all
        // render inside the body, so a light edit of the prefilled body keeps
        // them). Distinct from review/resolve/pipeline, whose internal blocks
        // carry the contracts and re-append around their body slot.
        return {
          configBody,
          assembly: prompts.assemblePrompt(
            NODE_KEYS.BUILD,
            { ticket: this.ctxHelper.taskContext(ctx), branch, mode },
            { instructions, plan: scopedPlan, checklist },
            { body: configBody },
          ),
        };
      }
      const final = prompts.resolve(
        NODE_KEYS.BUILD,
        { ticket: this.ctxHelper.taskContext(ctx), branch, mode },
        { instructions, plan: scopedPlan, checklist },
        configBody,
      );
      return {
        configBody,
        assembly: {
          body: configBody.trim(),
          blocks: [],
          final,
        },
      };
    }

    const assembly = prompts.assemblePrompt(
      NODE_KEYS.BUILD,
      { ticket: this.ctxHelper.taskContext(ctx), branch, mode },
      { instructions, plan: scopedPlan, checklist },
    );
    return { configBody: null, assembly };
  }
}
