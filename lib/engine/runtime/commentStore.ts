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
      const existing = await db.prisma.comment.findUnique({
        where: { id: c.id },
        select: { id: true, status: true, resolvedBy: true },
      });
      const status = c.resolved ? COMMENT_STATUS.RESOLVED : COMMENT_STATUS.OPEN;
      if (!existing) {
        await db.prisma.comment.create({
          data: {
            id: c.id,
            flowId,
            mrIid: mrIid ?? null,
            discussionId: c.threadId,
            author: c.author,
            body: c.body,
            filePath: c.path ?? null,
            line: c.line ?? null,
            status,
            raw: JSON.stringify(c),
            createdAt: new Date(c.createdAt),
            updatedAt: new Date(),
          },
        });
        if (status === COMMENT_STATUS.OPEN) newOpen++;
      } else if (existing.status !== status) {
        if (
          existing.status === COMMENT_STATUS.RESOLVED
          && existing.resolvedBy === "agent"
          && status === COMMENT_STATUS.OPEN
        ) {
          continue;
        }
        await db.prisma.comment.update({
          where: { id: c.id },
          data: { status, updatedAt: new Date() },
        });
        if (status === COMMENT_STATUS.OPEN) newOpen++;
      }
    }
    return newOpen;
  }
}

export const commentStore = processSingleton("commentStore", () => new CommentStore());
