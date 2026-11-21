import "server-only";

import { db } from "../../db/app";
import { NodeRow } from "../../db/rows";
import { ConflictError, NotFoundError, UpstreamError, ValidationError } from "../../errors";
import { parseRow } from "@/lib/db/ormRowHelpers";
import { ARTIFACT_KIND } from "../constants/vocabulary";
import { NODE_STATUS } from "../constants/nodeStatus";
import { engineParts } from "@/lib/composition/container";
import { DIFF_ATTRIBUTION } from "../facts/constants/diffFactMeta";
import { parseDiffFactMeta, type DiffFactMeta } from "../facts/schemas/diffFactMeta";
import type { DiffCapture, DiffFactInput } from "../facts/types/facts";
import { flowCtxHelper } from "../nodes/shared/runContext";
import type { DiffRefreshHost } from "./types/diffRefreshHost";

/**
 * FlowDiffRefreshService — the diff fact's read-only re-capture (Task 08).
 * The panel's "Refresh diff" action lands here: the capture's `headSha` is
 * the branch head at the last capture, and the branch moving past it is what
 * the panel's staleness badge reports — this service re-runs
 * `flowCtxHelper.makeDiff` (the same seam `stepRollup` runs its captures on)
 * and persists a new artifact version.
 *
 * Invariants upheld:
 * - Git I/O runs BEFORE any DB write (the stepRollup precedent — git never
 *   joins a transaction, Invariant 7); the new version saves in one
 *   `saveArtifact` transaction.
 * - Read-only claim discipline: the refresh never moves node status and never
 *   races a live attempt — a `running` node's attempt owns the capture, so a
 *   refresh against it refuses loudly (ConflictError) instead of capturing a
 *   half-written branch.
 * - Attribution is pinned at capture: an `agent`-attributed fact's content IS
 *   the run's own work — the refresh preserves those bytes and refreshes only
 *   the whole-branch projection and the `headSha` anchor, so a user commit
 *   made after the run never leaks into "Agent only". An `all`-attributed
 *   fact (the pre-Task-08 shape) refreshes wholesale.
 *
 * Must never: write node status, run more than one capture, or resurrect an
 * old artifact version — only the node's newest diff version refreshes.
 */
export class FlowDiffRefreshService {
  constructor(private readonly host: DiffRefreshHost) {}

  async refresh(flowId: string, artifactId: string): Promise<void> {
    const row = await db.prisma.artifact.findFirst({ where: { id: artifactId, flowId } });
    if (!row) throw new NotFoundError("artifact", artifactId);
    if (row.kind !== ARTIFACT_KIND.DIFF) throw new ValidationError(`artifact ${artifactId} is not a diff fact`);
    const meta = parseDiffFactMeta(row.meta);
    if (!meta) throw new ValidationError(`artifact ${artifactId} carries no readable diff meta`);
    const nodeRow = await db.prisma.node.findUnique({ where: { id: row.nodeId } });
    const node = nodeRow ? parseRow(NodeRow, nodeRow, `node ${row.nodeId} for flow ${flowId}`) : null;
    if (!node || node.flowId !== flowId) throw new NotFoundError("node", row.nodeId);
    if (node.status === NODE_STATUS.RUNNING) {
      throw new ConflictError(`the run on ${node.nodeKey} owns the diff — refresh after it finishes`);
    }
    // only the newest version refreshes — the UI offers the action on the
    // latest capture, and a superseded version must never win a version slot
    const top = await db.prisma.artifact.findFirst({
      where: { nodeId: node.id, kind: ARTIFACT_KIND.DIFF },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    if (top?.id !== artifactId) throw new ConflictError(`artifact ${artifactId} is superseded — refresh the newest diff instead`);

    // git I/O before any write (the stepRollup precedent)
    const ctx = await this.host.ctx(flowId);
    const fresh = await flowCtxHelper.makeDiff(ctx, meta.branch, { baseSha: meta.baseSha ?? null });
    if (!fresh || !fresh.raw) {
      throw new UpstreamError(`the diff capture for ${meta.branch} failed — check the repo's local checkout`);
    }
    await engineParts.facts.recordDiff(flowId, node.id, this.mergeRefresh(meta, row.content, fresh));
    await this.host.emitLifecycle(
      flowId,
      node.nodeKey,
      `diff re-captured for ${meta.branch} (head ${fresh.headSha ? fresh.headSha.slice(0, 8) : "unknown"})`,
    );
  }

  /**
   * The refreshed fact's payload: the agent projection's bytes are the
   * finalize capture — pinned, never recomputed (the user commits that
   * landed after the run stay out of "Agent only"); everything else — the
   * whole-branch projection, the head anchor, the uncommitted probe —
   * re-captures from git.
   */
  private mergeRefresh(meta: DiffFactMeta, currentContent: string, fresh: DiffCapture): DiffFactInput {
    const preserveAgent = meta.attribution === DIFF_ATTRIBUTION.AGENT && !meta.uncommitted;
    return {
      branch: meta.branch,
      raw: preserveAgent ? currentContent : fresh.raw,
      stat: preserveAgent ? meta.stat : fresh.stat,
      baseSha: meta.baseSha ?? fresh.baseSha,
      headSha: fresh.headSha,
      attribution: preserveAgent ? DIFF_ATTRIBUTION.AGENT : (fresh.attribution ?? DIFF_ATTRIBUTION.ALL),
      ...(fresh.uncommitted ? { uncommitted: true as const } : {}),
      ...(fresh.alt ? { alt: fresh.alt } : {}),
    };
  }
}