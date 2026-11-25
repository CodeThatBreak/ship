import { describe, expect, it } from "vitest";
import {
  parseReviewResponse,
  readPostedCommentHashes,
  reviewCommentPostHash,
} from "./reviewComments";

describe("parseReviewResponse — the three outcomes", () => {
  it("parses a fenced response object and validates items", () => {
    const text =
      "Here are issues:\n```json\n{\"verdict\":\"request_changes\",\"comments\":[{\"file\":\"a.ts\",\"line\":1,\"body\":\"fix me\"}]}\n```";
    const out = parseReviewResponse(text);
    expect(out).toEqual({
      outcome: "commented",
      verdict: "request_changes",
      comments: [{ file: "a.ts", line: 1, body: "fix me" }],
    });
  });

  it("a clean review is approve with an empty list — a real answer, not a miss", () => {
    const out = parseReviewResponse('{"verdict":"approve","comments":[]}');
    expect(out).toEqual({ outcome: "clean", verdict: "approve", comments: [] });
  });

  it("request_changes naming no change is a contradiction — invalid, not clean", () => {
    const out = parseReviewResponse('{"verdict":"request_changes","comments":[]}');
    expect(out.outcome).toBe("invalid");
    expect(out.outcome === "invalid" && out.warning).toContain("request_changes");
  });

  it("rejects items without a non-empty body", () => {
    const out = parseReviewResponse('{"verdict":"request_changes","comments":[{"file":"a.ts","body":""}]}');
    expect(out.outcome).toBe("invalid");
  });

  it("a bare array is a contract miss now — the verdict is required", () => {
    const out = parseReviewResponse('[{"file":"a.ts","line":1,"body":"fix me"}]');
    expect(out.outcome).toBe("invalid");
    expect(out.outcome === "invalid" && out.warning).toContain("{verdict, comments}");
  });

  it("warns when markdown brackets are not a valid response", () => {
    const out = parseReviewResponse("See [link](url) for context.");
    expect(out.outcome).toBe("invalid");
    expect(out.outcome === "invalid" && out.warning).toContain("parseable JSON");
  });

  it("an empty reply is a contract miss", () => {
    const out = parseReviewResponse("   ");
    expect(out.outcome).toBe("invalid");
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
