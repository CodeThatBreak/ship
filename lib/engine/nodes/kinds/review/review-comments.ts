import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { extractJson } from "../agent/json-schema-lite";

export const reviewCommentItemSchema = z.object({
  file: z.string().optional(),
  line: z.number().int().optional(),
  body: z.string().min(1),
});

export type ReviewCommentItem = z.infer<typeof reviewCommentItemSchema>;

const reviewCommentsSchema = z.array(reviewCommentItemSchema);

export type ParseReviewCommentsResult = {
  comments: ReviewCommentItem[];
  /** Set when the agent text could not be parsed into a valid comment list. */
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
  const result = reviewCommentsSchema.safeParse(parsed);
  if (!result.success) {
    return {
      comments: [],
      warning: "Review JSON did not match the expected comment array shape.",
    };
  }
  if (result.data.length === 0) {
    return { comments: [], warning: "Review JSON array was empty." };
  }
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

export const readPostedCommentHashes = (metaJson: string | null | undefined): string[] => {
  if (!metaJson) return [];
  try {
    const meta = JSON.parse(metaJson) as { postedHashes?: unknown };
    if (!Array.isArray(meta.postedHashes)) return [];
    return meta.postedHashes.filter((h): h is string => typeof h === "string");
  } catch {
    return [];
  }
};
