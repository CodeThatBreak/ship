import "server-only";

import { createHash } from "node:crypto";

/** Stable idempotency key for one posted reply (`reviewCommentPostHash` precedent). */
export const replyHash = (mrIid: number, threadId: string, body: string): string =>
  createHash("sha256").update(JSON.stringify({ mrIid, threadId, body })).digest("hex");
