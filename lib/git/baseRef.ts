import "server-only";

import { BaseRefNotFoundError } from "./gitErrors";

export const baseRefCandidates = (
  base?: string,
): { configured: string; candidates: readonly string[] } => {
  const configured = base?.trim() || "main";
  const candidates = [
    configured.startsWith("refs/") || configured.startsWith("origin/")
      ? configured
      : `origin/${configured}`,
    configured,
    "origin/master",
    "master",
  ] as const;
  return { configured, candidates };
};

/** Resolve a worktree base ref; never falls back to the hub's checked-out HEAD. */
export const resolveWorktreeBaseRef = async (
  refExists: (ref: string) => Promise<boolean>,
  base?: string,
): Promise<string> => {
  const { configured, candidates } = baseRefCandidates(base);
  for (const cand of candidates) {
    if (await refExists(cand)) return cand;
  }
  throw new BaseRefNotFoundError(configured, candidates);
};

/** Best available base ref for diffs (does not throw — picks the first match). */
export const localBranchBaseCandidates = (baseBranch: string): readonly string[] =>
  [`origin/${baseBranch}`, baseBranch, "origin/master", "master"] as const;
