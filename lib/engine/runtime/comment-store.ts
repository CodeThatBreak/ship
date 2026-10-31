import "server-only";

import { db } from "../../db";
import type { HostComment } from "../ports/git-host";
import { COMMENT_STATUS } from "../constants/vocabulary";
import { processSingleton } from "../../singleton";

/**
 * MR comment upserts for git-host ingestion (flow engine webhook paths).
 */
export class CommentStore {
  ingest(flowId: string, incoming: HostComment[], mrIid?: number): number {
    let newOpen = 0;
    for (const c of incoming) {
      if (c.system) continue;
      const existing = db.get<{ id: string; status: string; resolved_by: string | null }>(
        `SELECT id,status,resolved_by FROM comments WHERE id=?`,
        c.id,
      );
      const status = c.resolved ? COMMENT_STATUS.RESOLVED : COMMENT_STATUS.OPEN;
      if (!existing) {
        db.run(
          `INSERT INTO comments (id,flow_id,mr_iid,discussion_id,author,body,file_path,line,status,raw,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          c.id,
          flowId,
          mrIid ?? null,
          c.threadId,
          c.author,
          c.body,
          c.path ?? null,
          c.line ?? null,
          status,
          JSON.stringify(c),
          c.createdAt,
          db.now(),
        );
        if (status === COMMENT_STATUS.OPEN) newOpen++;
      } else if (existing.status !== status) {
        if (
          existing.status === COMMENT_STATUS.RESOLVED
          && existing.resolved_by === "agent"
          && status === COMMENT_STATUS.OPEN
        ) {
          continue;
        }
        db.run(`UPDATE comments SET status=?, updated_at=? WHERE id=?`, status, db.now(), c.id);
        if (status === COMMENT_STATUS.OPEN) newOpen++;
      }
    }
    return newOpen;
  }
}

export const commentStore = processSingleton("commentStore", () => new CommentStore());
