import "server-only";

/** The bounded hook-fix turn's prompt: the hook output, the worktree, one fix. */
import { TemplateRenderer } from "../../../shared/templateRenderer";

export const hookFixPrompt = (hookDetail: string, branch: string): string =>
  TemplateRenderer.compose(
    `The engine's push of branch ${branch} was rejected by a repository hook (pre-push/pre-receive).`,
  )
    .addBlankLine()
    .section("Hook output", hookDetail)
    .addBlankLine()
    .addLine(
      "Fix the failure in this worktree, commit the fix to the branch, and answer with one JSON object " +
        '{"summary": "<what you fixed>"} — the engine will re-push once.',
    )
    .build();
