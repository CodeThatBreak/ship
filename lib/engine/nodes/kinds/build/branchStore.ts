import "server-only";

import { db } from "../../../../db/app";
import { BranchRow, rows } from "../../../../db/rows";

/**
 * Store for per-flow branch rows: upserts, status/MR updates, and tagging the
 * latest run row with a branch for per-branch cost attribution.
 */
export class BranchStore {
  /** Insert or update a branch row for a flow. Returns the row id. */
  upsert(
    flowId: string,
    name: string,
    opts: {
      title?: string;
      status?: string;
      mrUrl?: string;
      mrIid?: number;
      gitBranch?: string;
      order?: number;
    } = {},
  async ): string {
    const existing = db.get<{ id: string }>(`SELECT id FROM branches WHERE flow_id=$1 AND name=$2`, flowId, name);
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (opts.title !== undefined) patch.title = opts.title;
      if (opts.status !== undefined) patch.status = opts.status;
      if (opts.mrUrl !== undefined) patch.mrUrl = opts.mrUrl;
      if (opts.mrIid !== undefined) patch.mrIid = opts.mrIid;
      if (opts.gitBranch !== undefined) patch.gitBranch = opts.gitBranch;
      if (Object.keys(patch).length) {
        const keys = Object.keys(patch);
        await db.run(`UPDATE branches SET ${keys.map((k) => `${k}=?`).join(",")}, updated_at=? WHERE id=?`,
          ...keys.map((k) => patch[k] as never), db.now(), existing.id);
      }
      return existing.id;
    }
    const id = db.uid("br_");
    await db.run(
      `INSERT INTO branches (id,flow_id,name,git_branch,title,status,mr_url,mr_iid,"order",created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      id, flowId, name, opts.gitBranch ?? null, opts.title ?? name, opts.status ?? "pending",
      opts.mrUrl ?? null, opts.mrIid ?? null, opts.order ?? 0, db.now(), db.now()
    );
    return id;
  }

  /** Persisted git ref for a plan branch row (null before the build finishes). */
  gitBranch(flowId: string, planBranchName: string): string | null {
    return db.get<{ git_branch: string | null }>(
      `SELECT git_branch AS "gitBranch" FROM branches WHERE flow_id=$1 AND name=$2`, flowId, planBranchName,
    )?.gitBranch ?? null;
  }

  /** Tag a specific run row with a branch_id (per-branch cost attribution). */
  async tagRun(runRowId: string, branchRowId: string): void {
    await db.run(
      `UPDATE runs SET branch_id=$1, updated_at=$2 WHERE id=$3`,
      branchRowId, db.now(), runRowId,
    );
  }

  /** Get all branch rows for a flow, ordered. */
  list(flowId: string): BranchRow[] {
    return rows.all(BranchRow, `SELECT id, flow_id AS "flowId", name, git_branch AS "gitBranch", title, status, mr_url AS "mrUrl", mr_iid AS "mrIid", "order", created_at AS "createdAt", updated_at AS "updatedAt" FROM branches WHERE flow_id=$1 ORDER BY "order", created_at`, flowId);
  }
}

export const branchStore = new BranchStore();
