import "server-only";

import { db } from "../../db/app";
import type { QueryExecutor } from "../../db/database";
import type { BranchRow } from "../../db/rows";
import { ARTIFACT_KIND } from "../constants/vocabulary";
import type { NodeSupport } from "../nodes/shared/nodeSupport";
import type { BranchStore } from "../nodes/kinds/build/branchStore/branchStore";
import { BRANCH_FACT_STATUS } from "./constants/branchFactStatus";
import { DIFF_ATTRIBUTION, DIFF_FACT_META } from "./constants/diffFactMeta";
import { FACT_KIND } from "./types/facts";
import type {
  BranchFactInput,
  ChangeRequestFact,
  ChangeRequestFactInput,
  DiffFactInput,
} from "./types/facts";

/**
 * FactStore — the typed fact vocabulary (design §4.1, Task 06). Persists
 * `branch` / `diff` / `change_request` facts into the homes that already
 * exist — branch rows, `kind: "diff"` artifacts, the flow's MR columns — and
 * resolves fact lookups for resolvers and the flow context.
 *
 * Invariants upheld:
 * - F2: every fact write lands in the caller's transaction (the terminal
 *   write's batch) when one is passed; a bare call runs inside its own single
 *   DB transaction, so a fact is never half-written.
 * - Git/HTTP I/O never happens here: callers capture diff payloads BEFORE the
 *   batch (the stepRollup precedent) and hand the captured result in.
 *
 * Must never:
 * - create tables, columns or any shadow store — the vocabulary is a
 *   formalization over existing homes only;
 * - run git or HTTP I/O (inside a transaction or at all);
 * - write `nodes.status` — facts ride the terminal write, they never move it.
 */
export class FactStore {
  constructor(
    private readonly support: NodeSupport,
    private readonly branches: BranchStore,
  ) {}

  // ── writes ───────────────────────────────────────────────────────────────

  /** Persist a `branch` fact: upsert the branch row, status stamped
   *  `building` (see `branchFactStatus` for the `pushed` deviation). */
  recordBranch(flowId: string, fact: BranchFactInput, tx?: QueryExecutor): Promise<string> {
    return this.support.transaction(async (inner) => {
      return this.branches.upsert(flowId, fact.name, {
        title: fact.title ?? undefined,
        gitBranch: fact.gitBranch ?? undefined,
        status: BRANCH_FACT_STATUS,
      }, inner);
    }, tx);
  }

  /**
   * Persist a `diff` fact: a `kind: "diff"` artifact. The meta carries the
   * pre-Task-08 `{branch, stat}` keys plus the Task 08 attribution shape —
   * `baseSha` (the run-start anchor), `headSha` (the staleness anchor the
   * refresh action bumps), `attribution`, the `uncommitted` flag and the
   * alternate projection when both are computable.
   */
  recordDiff(flowId: string, nodeId: string, fact: DiffFactInput, tx?: QueryExecutor): Promise<{ id: string; version: number }> {
    const meta: Record<string, unknown> = {
      [DIFF_FACT_META.BRANCH]: fact.branch,
      [DIFF_FACT_META.STAT]: fact.stat,
      [DIFF_FACT_META.ATTRIBUTION]: fact.attribution ?? DIFF_ATTRIBUTION.ALL,
    };
    if (fact.baseSha) meta[DIFF_FACT_META.BASE_SHA] = fact.baseSha;
    if (fact.headSha) meta[DIFF_FACT_META.HEAD_SHA] = fact.headSha;
    if (fact.uncommitted) meta[DIFF_FACT_META.UNCOMMITTED] = true;
    if (fact.alt) meta[DIFF_FACT_META.ALT] = fact.alt;
    return this.support.saveArtifact(
      nodeId,
      flowId,
      ARTIFACT_KIND.DIFF,
      fact.raw,
      meta,
      undefined,
      tx,
    );
  }

  /** Persist a `change_request` fact: the named branch row's `mrIid`/`mrUrl`,
   *  or — with no branch name — the flow-level MR columns. */
  async recordChangeRequest(flowId: string, fact: ChangeRequestFactInput, tx?: QueryExecutor): Promise<void> {
    await this.support.transaction(async (inner) => {
      if (fact.branchName) {
        await this.branches.upsert(flowId, fact.branchName, {
          mrIid: fact.mrIid,
          mrUrl: fact.mrUrl ?? undefined,
        }, inner);
        return;
      }
      // flow-level MR: set-if-present — a null url never clobbers an existing one
      const data: { mrIid: number; mrUrl?: string; updatedAt: Date } = { mrIid: fact.mrIid, updatedAt: new Date() };
      if (fact.mrUrl !== null) data.mrUrl = fact.mrUrl;
      await inner.flow.update({ where: { id: flowId }, data });
    }, tx);
  }

  // ── lookups (read model for resolvers and the flow context) ─────────────

  /** The flow's `branch` facts — the branch rows (all of them; rows are few). */
  async branchFacts(flowId: string): Promise<BranchRow[]> {
    return this.branches.list(flowId);
  }

  /** One `branch` fact by name — null when no run established it. */
  async branchFact(flowId: string, name: string): Promise<BranchRow | null> {
    const rows = await this.branches.list(flowId);
    return rows.find((row) => row.name === name) ?? null;
  }

  /** The flow's `diff` facts — `kind: "diff"` artifacts, newest first. Raw
   *  meta comes back unparsed; callers own the `{branch, stat}` shape. */
  async diffFacts(flowId: string, opts: { limit?: number } = {}): Promise<{ id: string; version: number; content: string; meta: unknown }[]> {
    return this.support.artifactsOfKind(flowId, FACT_KIND.DIFF, opts);
  }

  /**
   * The flow's `change_request` fact, resolved in the design §4.1 order:
   * the named branch row's MR → the flow-level MR → the most recent branch
   * row carrying an MR. Null when no run established one.
   */
  async changeRequestFact(flowId: string, branchName?: string | null): Promise<ChangeRequestFact | null> {
    if (branchName) {
      const row = await this.branchFact(flowId, branchName);
      if (row?.mrIid != null) {
        return { mrIid: row.mrIid, mrUrl: row.mrUrl, branchName: row.name };
      }
      return null;
    }
    const flow = await db.prisma.flow.findUnique({
      where: { id: flowId },
      select: { mrIid: true, mrUrl: true },
    });
    if (flow?.mrIid != null) {
      return { mrIid: flow.mrIid, mrUrl: flow.mrUrl, branchName: null };
    }
    const latest = await this.branches.latestWithMr(flowId);
    if (!latest) return null;
    const row = await this.branchFact(flowId, latest.name);
    return { mrIid: latest.mrIid, mrUrl: row?.mrUrl ?? null, branchName: latest.name };
  }
}
