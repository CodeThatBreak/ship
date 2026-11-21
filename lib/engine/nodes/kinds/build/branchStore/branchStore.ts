import "server-only";

import { db } from "../../../../../db/app";
import { BranchRow } from "../../../../../db/rows";
import { type BranchStatus } from "../../../../../db/constants/rowStatuses";
import type { QueryExecutor } from "../../../../../db/database";

/**
 * Store for per-flow branch rows: upserts, status/MR updates, and tagging the
 * latest run row with a branch for per-branch cost attribution.
 */
export class BranchStore {
  /** Insert or update a branch row for a flow. Returns the row id. */
  async upsert(
    flowId: string,
    name: string,
    opts: {
      title?: string;
      status?: BranchStatus;
      mrUrl?: string;
      mrIid?: number;
      gitBranch?: string;
      order?: number;
    } = {},
    tx?: QueryExecutor,
  ): Promise<string> {
    const client = tx ?? db.prisma;
    const existing = await client.branch.findFirst({
      where: { flowId, name },
      select: { id: true },
    });
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (opts.title !== undefined) patch.title = opts.title;
      if (opts.status !== undefined) patch.status = opts.status;
      if (opts.mrUrl !== undefined) patch.mrUrl = opts.mrUrl;
      if (opts.mrIid !== undefined) patch.mrIid = opts.mrIid;
      if (opts.gitBranch !== undefined) patch.gitBranch = opts.gitBranch;
      if (Object.keys(patch).length) {
        await client.branch.update({
          where: { id: existing.id },
          data: { ...patch, updatedAt: new Date() } as never,
        });
      }
      return existing.id;
    }
    const id = db.uid("br_");
    await client.branch.create({
      data: {
        id, flowId, name,
        gitBranch: opts.gitBranch ?? null,
        title: opts.title ?? name,
        status: opts.status ?? "pending",
        mrUrl: opts.mrUrl ?? null,
        mrIid: opts.mrIid ?? null,
        order: opts.order ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return id;
  }

  /** Persisted git ref for a plan branch row (null before the build finishes). */
  async gitBranch(flowId: string, planBranchName: string): Promise<string | null> {
    const row = await db.prisma.branch.findFirst({
      where: { flowId, name: planBranchName },
      select: { gitBranch: true },
    });
    return row?.gitBranch ?? null;
  }

  /**
   * The most recently updated branch row carrying an MR (the change_request
   * fact fallback) — null when no branch of the flow has an MR yet.
   */
  async latestWithMr(
    flowId: string,
  ): Promise<{ name: string; mrIid: number; gitBranch: string | null } | null> {
    const row = await db.prisma.branch.findFirst({
      where: { flowId, mrIid: { not: null } },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { name: true, mrIid: true, gitBranch: true },
    });
    if (!row || row.mrIid === null) return null;
    return { name: row.name, mrIid: row.mrIid, gitBranch: row.gitBranch };
  }

  /** Tag a specific run row with a branch_id (per-branch cost attribution). */
  async tagRun(runRowId: string, branchRowId: string): Promise<void> {
    await db.prisma.run.updateMany({
      where: { id: runRowId },
      data: { branchId: branchRowId, updatedAt: new Date() },
    });
  }

  /** Get all branch rows for a flow, ordered. */
  async list(flowId: string, tx?: QueryExecutor): Promise<BranchRow[]> {
    const rows = await (tx ?? db.prisma).branch.findMany({
      where: { flowId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    const decoded: BranchRow[] = [];
    for (const raw of rows) {
      const result = BranchRow.safeParse(raw);
      if (result.success) decoded.push(result.data);
    }
    return decoded;
  }
}

