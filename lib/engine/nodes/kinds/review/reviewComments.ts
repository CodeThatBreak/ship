import "server-only";

import { createHash } from "node:crypto";
import { extractJson } from "../../shared/extractJson";
import { ReviewResponseSchema, type ReviewCommentItem } from "./schema";
import type { ReviewVerdict } from "./constants/reviewVerdict";

/**
 * What the agent said about the change — three distinct states, because
 * "nothing to flag" is an answer and a missing answer is not.
 *
 * - `clean`: the agent approved and flagged nothing. A successful run that
 *   posts nothing; the verdict is what makes it legible.
 * - `commented`: at least one comment to post.
 * - `invalid`: the reply was not a contract-valid review (empty, unparseable,
 *   wrong shape, or `request_changes` with nothing to change — an agent that
 *   asks for changes must name them). The caller fails the node loudly.
 */
export type ParsedReviewResponse =
  | { outcome: "clean"; verdict: ReviewVerdict; comments: [] }
  | { outcome: "commented"; verdict: ReviewVerdict; comments: ReviewCommentItem[] }
  | { outcome: "invalid"; warning: string };

/** Pull and validate the agent's review response (CR-085). */
export const parseReviewResponse = (text: string): ParsedReviewResponse => {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return { outcome: "invalid", warning: "Review agent returned empty output — no comments posted." };
  }
  const parsed = extractJson(trimmed);
  if (parsed == null) {
    return { outcome: "invalid", warning: "Review output had no parseable JSON review response." };
  }
  const result = ReviewResponseSchema.safeParse(parsed);
  if (!result.success) {
    return {
      outcome: "invalid",
      warning: "Review JSON did not match the expected {verdict, comments} response shape.",
    };
  }
  const { verdict, comments } = result.data;
  if (comments.length === 0) {
    if (verdict === "approve") return { outcome: "clean", verdict, comments: [] };
    return {
      outcome: "invalid",
      warning: "Review requested changes but named none — request_changes needs at least one comment.",
    };
  }
  return { outcome: "commented", verdict, comments };
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
