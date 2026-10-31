import "server-only";

import { db } from "../../../../db";
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
  ): string {
    const existing = db.get<{ id: string }>(`SELECT id FROM branches WHERE flow_id=? AND name=?`, flowId, name);
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (opts.title !== undefined) patch.title = opts.title;
      if (opts.status !== undefined) patch.status = opts.status;
      if (opts.mrUrl !== undefined) patch.mr_url = opts.mrUrl;
      if (opts.mrIid !== undefined) patch.mr_iid = opts.mrIid;
      if (opts.gitBranch !== undefined) patch.git_branch = opts.gitBranch;
      if (Object.keys(patch).length) {
        const keys = Object.keys(patch);
        db.run(`UPDATE branches SET ${keys.map((k) => `${k}=?`).join(",")}, updated_at=? WHERE id=?`,
          ...keys.map((k) => patch[k] as never), db.now(), existing.id);
      }
      return existing.id;
    }
    const id = db.uid("br_");
    db.run(
      `INSERT INTO branches (id,flow_id,name,git_branch,title,status,mr_url,mr_iid,"order",created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, flowId, name, opts.gitBranch ?? null, opts.title ?? name, opts.status ?? "pending",
      opts.mrUrl ?? null, opts.mrIid ?? null, opts.order ?? 0, db.now(), db.now()
    );
    return id;
  }

  /** Persisted git ref for a plan branch row (null before the build finishes). */
  gitBranch(flowId: string, planBranchName: string): string | null {
    return db.get<{ git_branch: string | null }>(
      `SELECT git_branch FROM branches WHERE flow_id=? AND name=?`, flowId, planBranchName,
    )?.git_branch ?? null;
  }

  /** Tag a specific run row with a branch_id (per-branch cost attribution). */
  tagRun(runRowId: string, branchRowId: string): void {
    db.run(
      `UPDATE runs SET branch_id=?, updated_at=? WHERE id=?`,
      branchRowId, db.now(), runRowId,
    );
  }

  /** Get all branch rows for a flow, ordered. */
  list(flowId: string): BranchRow[] {
    return rows.all(BranchRow, `SELECT * FROM branches WHERE flow_id=? ORDER BY "order", created_at`, flowId);
  }
}

export const branchStore = new BranchStore();
