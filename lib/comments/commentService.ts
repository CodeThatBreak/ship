import "server-only";

import { db } from "../db/app";
import { processSingleton } from "../singleton";
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
  listForFlow(flowId: string): ApiComment[] {
    return db
      .all<{
        id: string;
        discussion_id: string | null;
        author: string | null;
        body: string;
        status: string;
        raw: string | null;
        created_at: string;
      }>(`SELECT * FROM comments WHERE flow_id=? ORDER BY created_at DESC`, flowId)
      .map((c): ApiComment => {
        let parsed: Partial<HostComment> = {};
        try {
          parsed = c.raw ? (JSON.parse(c.raw) as Partial<HostComment>) : {};
        } catch {
          parsed = {};
        }
        return {
          id: c.id,
          threadId: c.discussion_id,
          author: c.author,
          body: c.body,
          path: parsed.path ?? null,
          line: parsed.line ?? null,
          status: c.status,
          resolvable: typeof parsed.resolvable === "boolean" ? parsed.resolvable : true,
          resolved:
            typeof parsed.resolved === "boolean" ? parsed.resolved : c.status === COMMENT_RESOLVED,
          createdAt: parsed.createdAt ?? c.created_at,
        };
      });
  }
}

export const commentService = processSingleton(
  "commentService",
  () => new CommentService(),
);
