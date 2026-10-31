import { describe, expect, it } from "vitest";
import {
  parseReviewComments,
  readPostedCommentHashes,
  reviewCommentPostHash,
} from "./review-comments";

describe("parseReviewComments", () => {
  it("parses a fenced JSON array and validates items", () => {
    const text = "Here are issues:\n```json\n[{\"file\":\"a.ts\",\"line\":1,\"body\":\"fix me\"}]\n```";
    expect(parseReviewComments(text).comments).toEqual([
      { file: "a.ts", line: 1, body: "fix me" },
    ]);
  });

  it("rejects items without a non-empty body", () => {
    const out = parseReviewComments('[{"file":"a.ts","body":""}]');
    expect(out.comments).toHaveLength(0);
    expect(out.warning).toBeTruthy();
  });

  it("warns when markdown brackets are not a valid comment array", () => {
    const out = parseReviewComments("See [link](url) for context.");
    expect(out.comments).toHaveLength(0);
    expect(out.warning).toContain("parseable JSON");
  });
});

describe("review comment idempotency hashes", () => {
  it("produces stable hashes per MR and comment body", () => {
    const h1 = reviewCommentPostHash(5, { body: "x", file: "f" }, "inline");
    const h2 = reviewCommentPostHash(5, { body: "x", file: "f" }, "inline");
    const h3 = reviewCommentPostHash(6, { body: "x", file: "f" }, "inline");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it("reads postedHashes from artifact meta", () => {
    expect(readPostedCommentHashes(JSON.stringify({ postedHashes: ["a", 1, "b"] }))).toEqual(["a", "b"]);
    expect(readPostedCommentHashes(null)).toEqual([]);
  });
});
