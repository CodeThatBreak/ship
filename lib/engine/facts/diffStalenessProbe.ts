import "server-only";

import fs from "fs";
import path from "path";
import { db } from "../../db/app";
import type { ArtifactRow } from "../../db/rows";
import { localGit } from "../../git/local";
import { ARTIFACT_KIND } from "../constants/vocabulary";
import { DIFF_FACT_META } from "./constants/diffFactMeta";
import type { DiffStaleness } from "./types/diffStaleness";

/** The staleness read the artifact detail payload carries (Task 08) — the
 *  shape lives in `types/diffStaleness.ts` (class files are pure). */

/**
 * DiffStalenessProbe — the read-only staleness read behind the artifact
 * detail payload (Task 08). The branch row carries no head-SHA column (the
 * extensibility plan adds no migrations), so the branch's last-seen head
 * lives on the diff fact's meta (`headSha`) and the LIVE head is probed at
 * read time: one bounded local rev-parse, in the same local-first order
 * `makeDiff` probes (the flow's worktree, then the repo's hub checkout).
 * Unprobeable (no local checkout, gone branch) reads as not stale — the
 * absence of a probe never fabricates a staleness signal.
 *
 * Must never: run git I/O other than the one rev-parse, fetch from the
 * network, or persist anything.
 */
export class DiffStalenessProbe {
  async describe(artifact: ArtifactRow): Promise<ArtifactRow & Partial<DiffStaleness>> {
    if (artifact.kind !== ARTIFACT_KIND.DIFF) return artifact;
    const meta = artifact.meta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return artifact;
    const branch = meta[DIFF_FACT_META.BRANCH];
    const headSha = meta[DIFF_FACT_META.HEAD_SHA];
    if (typeof branch !== "string" || !branch) return artifact;
    if (typeof headSha !== "string" || !headSha) return artifact;
    const live = await this.liveHeadSha(artifact.flowId, branch);
    if (live == null) return artifact;
    return { ...artifact, branchHeadStale: live !== headSha };
  }

  /** The branch's current head — worktree first, then the hub checkout. */
  private async liveHeadSha(flowId: string, branchName: string): Promise<string | null> {
    const flow = await db.prisma.flow.findUnique({
      where: { id: flowId },
      select: { worktreeDir: true, repoId: true },
    });
    if (!flow) return null;
    // the fact's branch name is the plan-side name; the row's gitBranch is
    // the actual ref when they differ
    const row = await db.prisma.branch.findFirst({
      where: { flowId, name: branchName },
      select: { gitBranch: true },
    });
    const gitRef = row?.gitBranch || branchName;
    const repo = flow.repoId ? await db.repoById(flow.repoId) : null;
    const dirs = [flow.worktreeDir, repo?.localPath ?? null].filter((d): d is string => Boolean(d));
    for (const dir of dirs) {
      if (!fs.existsSync(path.join(dir, ".git"))) continue;
      const sha = await localGit.resolveSha(dir, gitRef);
      if (sha) return sha;
    }
    return null;
  }
}