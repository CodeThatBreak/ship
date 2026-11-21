import "server-only";

import type { AgentRunResult } from "../../../ports/agentPort";
import type { AgentDef } from "../../schemas/declarativeSchemas";
import { FACT_KIND, type BranchFactInput, type DiffFactInput } from "../../../facts/types/facts";
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
 * stepRollup precedent: git never joins a transaction).
 */
export type DiffCapture = (branch: string) => Promise<{ stat: string; raw: string } | null>;

/**
 * Map a run's `result.git` onto the facts its def declared in `produces`
 * (Task 07, Invariant F4): one `branch` fact per reported branch, plus one
 * `diff` fact per branch whose payload is captured through `captureDiff`.
 * Undeclared kinds stay dropped — `produces: []` yields null and runs no git
 * I/O at all. A per-branch capture failure is non-fatal (the stepRollup
 * precedent): the diff fact is still established, its content names the
 * capture as unavailable.
 */
export const agentFactIntents = async (
  result: AgentRunResult,
  cfg: AgentDef,
  captureDiff: DiffCapture,
): Promise<AgentFactIntents | null> => {
  const branches: BranchFactInput[] = [];
  const diffs: DiffFactInput[] = [];
  for (const entry of result.git?.branches ?? []) {
    if (!entry?.branch) continue; // a malformed/empty report entry establishes nothing
    const name = entry.branch;
    if (cfg.produces.includes(FACT_KIND.BRANCH)) {
      branches.push({ name, gitBranch: name });
    }
    if (cfg.produces.includes(FACT_KIND.DIFF)) {
      let captured: { stat: string; raw: string } | null = null;
      try {
        captured = await captureDiff(name);
      } catch {
        // per-branch capture failure is non-fatal (the stepRollup precedent)
      }
      diffs.push({ branch: name, raw: captured?.raw ?? DIFF_UNAVAILABLE_CONTENT, stat: captured?.stat ?? "" });
    }
  }
  if (!branches.length && !diffs.length) return null;
  return { branches, diffs };
};
