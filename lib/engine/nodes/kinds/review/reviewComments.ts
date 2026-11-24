import "server-only";

import { createHash } from "node:crypto";
import { extractJson } from "../../shared/extractJson";
import { ReviewCommentsSchema, type ReviewCommentItem } from "./schema";

export type ParseReviewCommentsResult = {
  comments: ReviewCommentItem[];
  /** Set when the agent text could not be parsed into a valid comment list.
   *  A valid `[]` (the prompt's "no findings" answer) is not a warning. */
  warning?: string;
};

/** Pull and validate review comments from agent output (CR-085). */
export const parseReviewComments = (text: string): ParseReviewCommentsResult => {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return { comments: [], warning: "Review agent returned empty output — no comments posted." };
  }
  const parsed = extractJson(trimmed);
  if (parsed == null) {
    return {
      comments: [],
      warning: "Review output had no parseable JSON comment array.",
    };
  }
  const result = ReviewCommentsSchema.safeParse(parsed);
  if (!result.success) {
    return {
      comments: [],
      warning: "Review JSON did not match the expected comment array shape.",
    };
  }
  // a valid `[]` is the contract's "no findings" answer (promptDefaults:
  // "If none, return []") — no warning, the node completes with 0 comments
  return { comments: result.data };
};

/** Stable idempotency key for one MR comment body (CR-086). */
export const reviewCommentPostHash = (
  mrIid: number,
  comment: ReviewCommentItem,
  style: "inline" | "summary",
): string => {
  const payload = JSON.stringify({
    mrIid,
    style,
    file: comment.file ?? null,
    line: comment.line ?? null,
    body: comment.body,
  });
  return createHash("sha256").update(payload).digest("hex");
};

export const readPostedCommentHashes = (meta: unknown): string[] => {
  if (meta == null || meta === "") return [];
  try {
    // artifact meta was a serialized JSON string pre-Postgres; the Json column
    // now surfaces it already-parsed — tolerate both (legacy meta blobs keep
    // their round-trip behavior)
    const metaObj =
      typeof meta === "string" ? (JSON.parse(meta) as unknown) : meta;
    const postedHashes =
      metaObj && typeof metaObj === "object"
        ? (metaObj as { postedHashes?: unknown }).postedHashes
        : undefined;
    if (!Array.isArray(postedHashes)) return [];
    return postedHashes.filter((h): h is string => typeof h === "string");
  } catch {
    return [];
  }
};
