import "server-only";

import type { AgentRunResult } from "../../../ports/agentPort";
import type { AgentDef } from "../../schemas/declarativeSchemas";
import { FACT_KIND, type BranchFactInput, type DiffCapturePayload, type DiffFactInput } from "../../../facts/types/facts";
import { DIFF_UNAVAILABLE_CONTENT } from "../../../facts/constants/diffCapture";

/**
 * The fact intents a finished agent run carries (Task 07): the run's
 * self-reported git facts mapped through the def's `produces` declaration.
 * Pure data by the time it reaches `applyOutcome` — the diff payloads were
 * captured from git before the terminal write's batch.
 */
export interface AgentFactIntents {
  /** one `branch` fact per reported branch → a branchStore row */
  branches: BranchFactInput[];
  /** one `diff` fact per reported branch → a `kind: "diff"` artifact */
  diffs: DiffFactInput[];
}

/**
 * The diff-capture seam: `ctxHelper.makeDiff` — git I/O, so the caller binds
 * it and runs the collection BEFORE the terminal write's batch (the
 * stepRollup precedent: git never joins a transaction). Task 08: the capture
 * returns the attribution projections (the run's `baseSha` pins the "agent"
 * range), so the fact's meta can distinguish the agent's work from the
 * branch's whole diff.
 */
export type DiffCaptureFn = (branch: string) => Promise<DiffCapturePayload | null>;

/**
 * Local-mode branch fallback: a local run that committed but never pushed
 * reports no `git.branches`, yet the engine owns the worktree and can read its
 * HEAD. The caller binds `localGit.currentBranch` on the run cwd; this seam is
 * invoked lazily — only when a fact kind is declared and no branch was
 * self-reported — so cloud runs and undeclared facts do no extra git I/O.
 */
export type LocalBranchResolver = () => Promise<string | null>;

export interface AgentFactIntentOptions {
  resolveLocalBranch?: LocalBranchResolver;
  /**
   * The write-path reuse guard (agent kind): true means the persisted diff
   * fact for this branch is still current, so no new capture is emitted. The
   * decision comes from an injected callback — this mapper stays pure data
   * and owns no git/DB I/O.
   */
  reuseUnchangedDiff?: (branch: string) => Promise<boolean>;
}

/**
 * Map a run's `result.git` onto the facts its def declared in `produces`
 * (Task 07, Invariant F4): one `branch` fact per reported branch, plus one
 * `diff` fact per branch whose payload is captured through `captureDiff`.
 * Undeclared kinds stay dropped — `produces: []` yields null and runs no git
 * I/O at all. A local fallback branch is used only when the run reported none;
 * a per-branch capture failure is non-fatal (the stepRollup precedent): the
 * diff fact is still established, its content names the capture as unavailable.
 * Reported branch names are deduplicated, and an injected `reuseUnchangedDiff`
 * guard can skip a capture whose persisted fact is still current.
 */
export const agentFactIntents = async (
  result: AgentRunResult,
  cfg: AgentDef,
  captureDiff: DiffCaptureFn,
  options: AgentFactIntentOptions = {},
): Promise<AgentFactIntents | null> => {
  const branches: BranchFactInput[] = [];
  const diffs: DiffFactInput[] = [];
  // Reported branches are a set, not a list: a run that pushed the same ref
  // twice must not pay for two captures or publish two facts for it.
  const reported = [...new Set((result.git?.branches ?? [])
    .map((entry) => entry?.branch)
    .filter((name): name is string => typeof name === "string" && name.length > 0))];
  const declaresFacts =
    cfg.produces.includes(FACT_KIND.BRANCH) || cfg.produces.includes(FACT_KIND.DIFF);
  let branchNames = reported;
  if (!branchNames.length && declaresFacts && options.resolveLocalBranch) {
    let local: string | null = null;
    try {
      local = await options.resolveLocalBranch();
    } catch {
      // the worktree probe is best-effort, like a per-branch diff capture
    }
    if (local) branchNames = [local];
  }
  for (const name of branchNames) {
    if (cfg.produces.includes(FACT_KIND.BRANCH)) {
      branches.push({ name, gitBranch: name });
    }
    if (cfg.produces.includes(FACT_KIND.DIFF)) {
      // A prior capture with the same head/base and a clean worktree is still
      // valid — skip the git I/O entirely and leave the existing fact alone.
      if (await options.reuseUnchangedDiff?.(name)) continue;
      let captured: DiffCapturePayload | null = null;
      try {
        captured = await captureDiff(name);
      } catch {
        // per-branch capture failure is non-fatal (the stepRollup precedent)
      }
      diffs.push({
        branch: name,
        raw: captured?.raw ?? DIFF_UNAVAILABLE_CONTENT,
        stat: captured?.stat ?? "",
        ...(captured?.baseSha ? { baseSha: captured.baseSha } : {}),
        ...(captured?.headSha ? { headSha: captured.headSha } : {}),
        ...(captured?.attribution ? { attribution: captured.attribution } : {}),
        ...(captured?.uncommitted ? { uncommitted: true as const } : {}),
        ...(captured?.alt ? { alt: captured.alt } : {}),
      });
    }
  }
  if (!branches.length && !diffs.length) return null;
  return { branches, diffs };
};
