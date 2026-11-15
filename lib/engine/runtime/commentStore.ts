import "server-only";

import { db } from "../../db/app";
import type { HostComment } from "../ports/gitHost";
import { COMMENT_STATUS } from "../constants/vocabulary";
import { processSingleton } from "../../singleton";

/**
 * MR comment upserts for git-host ingestion (flow engine webhook paths).
 */
export class CommentStore {
  async ingest(flowId: string, incoming: HostComment[], mrIid?: number): Promise<number> {
    let newOpen = 0;
    for (const c of incoming) {
      if (c.system) continue;
      const existing = await db.get<{ id: string; status: string; resolvedBy: string | null }>(
        `SELECT id, status, resolved_by AS "resolvedBy" FROM comments WHERE id=$1`,
        c.id,
      );
      const status = c.resolved ? COMMENT_STATUS.RESOLVED : COMMENT_STATUS.OPEN;
      if (!existing) {
        await db.run(
          `INSERT INTO comments (id,flow_id,mr_iid,discussion_id,author,body,file_path,line,status,raw,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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
          && existing.resolvedBy === "agent"
          && status === COMMENT_STATUS.OPEN
        ) {
          continue;
        }
        await db.run(`UPDATE comments SET status=$1, updated_at=$2 WHERE id=$3`, status, db.now(), c.id);
        if (status === COMMENT_STATUS.OPEN) newOpen++;
      }
    }
    return newOpen;
  }
}

export const commentStore = processSingleton("commentStore", () => new CommentStore());
