import "server-only";

import { db } from "../db/app";
import { type HostComment } from "../engine/ports/gitHost";

export type ApiComment = {
  id: string;
  threadId: string | null;
  author: string | null;
  body: string;
  path: string | null;
  line: number | null;
  status: string;
  resolvable: boolean;
  resolved: boolean;
  createdAt: string;
};

const COMMENT_RESOLVED = "resolved";

export class CommentService {
  async listForFlow(flowId: string): Promise<ApiComment[]> {
    const comments = await db.all<{
      id: string;
      discussionId: string | null;
      author: string | null;
      body: string;
      status: string;
      raw: string | null;
      createdAt: string;
    }>(`SELECT id, flow_id AS "flowId", mr_iid AS "mrIid", discussion_id AS "discussionId", author, body, file_path AS "filePath", line, status, resolved_by AS "resolvedBy", raw, created_at AS "createdAt", updated_at AS "updatedAt" FROM comments WHERE flow_id=$1 ORDER BY created_at DESC`, flowId);
    return comments.map((c): ApiComment => {
        let parsed: Partial<HostComment> = {};
        try {
          parsed = c.raw ? (JSON.parse(c.raw) as Partial<HostComment>) : {};
        } catch {
          parsed = {};
        }
        return {
          id: c.id,
          threadId: c.discussionId,
          author: c.author,
          body: c.body,
          path: parsed.path ?? null,
          line: parsed.line ?? null,
          status: c.status,
          resolvable: typeof parsed.resolvable === "boolean" ? parsed.resolvable : true,
          resolved:
            typeof parsed.resolved === "boolean" ? parsed.resolved : c.status === COMMENT_RESOLVED,
          createdAt: parsed.createdAt ?? c.createdAt,
        };
      });
  }
}

/** Shared comments service (stateless — decision Q9, plain module const). */
export const commentService = new CommentService();
