import { describe, expect, it } from "vitest";

const { UNTRUSTED_DATA_NOTE, untrustedData, untrustedDataTruncationNote } = await import("./untrustedData");

describe("untrustedData", () => {
  it("fences the content in a source-tagged block prefixed by the never-instruct note", () => {
    const { text, truncated, originalLength } = untrustedData({ source: "MR diff", text: "diff body" });
    expect(text).toBe(
      [
        UNTRUSTED_DATA_NOTE,
        '<untrusted-data source="MR diff">',
        "diff body",
        "</untrusted-data>",
      ].join("\n"),
    );
    expect(truncated).toBe(false);
    expect(originalLength).toBe("diff body".length);
  });

  it("leaves empty input empty — nothing to fence", () => {
    expect(untrustedData({ source: "x", text: "" })).toEqual({ text: "", truncated: false, originalLength: 0 });
  });

  it("under the cap the text passes through whole and untruncated", () => {
    const { text, truncated } = untrustedData({ source: "task PRD", text: "short", cap: 10 });
    expect(text).toContain("short");
    expect(truncated).toBe(false);
    expect(text).not.toContain("[truncated");
  });

  it("a cap that bites truncates from the head and appends the loud in-prompt note", () => {
    const { text, truncated, originalLength } = untrustedData({ source: "MR diff", text: "abcdef", cap: 4 });
    expect(truncated).toBe(true);
    expect(originalLength).toBe(6);
    expect(text).toContain("abcd");
    expect(text).not.toContain("ef\n");
    expect(text).toContain(untrustedDataTruncationNote(4, 6, false));
    expect(text).toContain("[truncated to 4 of 6 characters — the source material was capped]");
  });

  it("tail mode keeps the LAST cap characters and says so", () => {
    const { text, truncated } = untrustedData({ source: "job log", text: "abcdef", cap: 4, tail: true });
    expect(truncated).toBe(true);
    expect(text).toContain("cdef");
    expect(text).not.toContain("ab\n");
    expect(text).toContain("[truncated to the last 4 of 6 characters — the source material was capped]");
  });

  it("exactly-at-cap content is not truncation", () => {
    expect(untrustedData({ source: "s", text: "abcdef", cap: 6 }).truncated).toBe(false);
  });

  it("renders the source verbatim and keeps the note outside the tag", () => {
    const { text } = untrustedData({ source: "job build #3", text: "log line" });
    expect(text).toContain('<untrusted-data source="job build #3">');
    expect(text.indexOf(UNTRUSTED_DATA_NOTE)).toBeLessThan(text.indexOf("<untrusted-data"));
  });
});
