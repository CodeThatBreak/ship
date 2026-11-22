import "server-only";

import { engineParts } from "@/lib/composition/container";
import { worktrees } from "../../../../git/worktrees";
import { DIFF_FACT_META } from "../../../facts/constants/diffFactMeta";
import { parseDiffFactMeta } from "../../../facts/schemas/diffFactMeta";
import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { FlowContextHelper } from "../../shared/runContext/flowContextHelper";

/**
 * The write-path reuse guard for an agent node's diff fact (the write half of
 * the staleness signal `DiffStalenessProbe` reads on the detail path). A
 * persisted diff artifact is byte-stable as long as the branch head it was
 * captured at, the base SHA it was attributed against, and the worktree's
 * dirtiness have not changed — so re-capturing it on every later run is pure
 * git I/O with nothing to publish.
 *
 * All checks here are cheap: ONE DB read of the flow's diff-fact meta, at
 * most two local rev-parses (`headShaOf`), and one `status --porcelain`. No
 * `makeDiff`, no fetch, no I/O inside a transaction. A "cannot prove unchanged"
 * answer is always false so the caller captures as before (and cloud mode,
 * with no local checkout, never reuses).
 */
export const diffFactUnchanged = async (
  ctx: FlowCtx,
  ctxHelper: FlowContextHelper,
  branch: string,
  baseSha: string | null,
): Promise<boolean> => {
  const anchors = await latestDiffAnchors(ctx.flow.id, branch);
  if (!anchors?.headSha) return false;
  // An uncommitted capture described the worktree, not a commit — once the
  // worktree changes (or is cleaned) that artifact must be re-captured.
  if (anchors.uncommitted) return false;
  if ((anchors.baseSha ?? null) !== (baseSha ?? null)) return false;

  const head = await ctxHelper.headShaOf(ctx, branch);
  if (head == null || head !== anchors.headSha) return false;

  const dir = ctxHelper.runCwd(ctx) ?? ctxHelper.localPath(ctx);
  if (dir && await worktrees.isWorktreeDirty(dir)) return false;

  return true;
};

/** The newest readable diff fact for this branch, reduced to its reuse
 *  anchors. `diffFacts` comes back newest first; anything unparseable or for
 *  another branch is skipped — a missing anchor never fabricates a match. */
const latestDiffAnchors = async (
  flowId: string,
  branch: string,
): Promise<{ headSha: string | null; baseSha: string | null; uncommitted: boolean } | null> => {
  for (const fact of await engineParts.facts.diffFacts(flowId)) {
    const meta = parseDiffFactMeta(fact.meta);
    if (!meta || meta[DIFF_FACT_META.BRANCH] !== branch) continue;
    return {
      headSha: meta[DIFF_FACT_META.HEAD_SHA] ?? null,
      baseSha: meta[DIFF_FACT_META.BASE_SHA] ?? null,
      uncommitted: meta[DIFF_FACT_META.UNCOMMITTED] ?? false,
    };
  }
  return null;
};
