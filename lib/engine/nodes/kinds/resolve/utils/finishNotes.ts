import "server-only";

/**
 * Pure note builders for the resolve finalize pipeline: the artifact content,
 * the run's push-state story for the lifecycle event, and the composed
 * lifecycle event line. No I/O — the finisher owns when they are emitted.
 */
import { TemplateRenderer } from "../../../shared/templateRenderer";
import { PUSH_STATE, type PushState } from "../constants/pushState";
import type { ResolveAgentResponse, ResolveCommentDecision, ResolveInput } from "../schema";

/** Artifact content: the agent's summary plus the rendered per-comment decision list. */
export const artifactContent = (response: ResolveAgentResponse): string => {
  const decisionLine = (d: ResolveCommentDecision): string =>
    `- [${d.id}] ${d.action}${d.reply ? ` — replied: ${d.reply}` : ""}${d.note ? ` (${d.note})` : ""}`;
  return TemplateRenderer.compose(response.summary)
    .addBlankLine()
    .addLines(response.decisions.map(decisionLine))
    .build();
};

/** The run's push-state story for the lifecycle event (§6A: the states read
 *  differently — "fixes pushed" vs "fixes committed locally but push failed"). */
export const pushNote = (pushState: PushState, failedPush: string | null): string => {
  switch (pushState) {
    case PUSH_STATE.PUSHED:
      return " — fixes pushed";
    case PUSH_STATE.LOCAL_ONLY:
      return failedPush
        ? ` — fixes committed locally but push failed: ${failedPush.slice(0, 200)}`
        : " — fixes committed locally but not pushed";
    case PUSH_STATE.UNKNOWN:
      return " — MR state could not be verified";
    default:
      return "";
  }
};

export const finishEvent = (
  input: ResolveInput,
  counts: { resolved: number; replied: number; hostFailures: number },
  pushState: PushState,
  failedPush: string | null,
): string =>
  `resolved ${counts.resolved} thread(s), replied ${counts.replied}` +
  `${input.branchName ? ` (${input.branchName})` : ""}` +
  `${pushNote(pushState, failedPush)}` +
  `${counts.hostFailures ? ` — ${counts.hostFailures} host effect(s) failed` : ""}`;
