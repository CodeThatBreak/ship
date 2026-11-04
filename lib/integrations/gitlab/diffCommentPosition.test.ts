import { describe, expect, it } from "vitest";
import { buildDiscussionPosition } from "./diffCommentPosition";

const refs = {
  baseSha: "base",
  startSha: "start",
  headSha: "head",
};

describe("buildDiscussionPosition", () => {
  it("maps a new-path line to a GitLab text position", () => {
    const position = buildDiscussionPosition(
      "src/a.ts",
      12,
      refs,
      [{ oldPath: "src/a.ts", newPath: "src/a.ts" }],
    );
    expect(position).toEqual({
      base_sha: "base",
      start_sha: "start",
      head_sha: "head",
      position_type: "text",
      old_path: "src/a.ts",
      new_path: "src/a.ts",
      new_line: 12,
    });
  });

  it("resolves renames via old path when the agent cites the former path", () => {
    const position = buildDiscussionPosition(
      "old/name.ts",
      3,
      refs,
      [{ oldPath: "old/name.ts", newPath: "new/name.ts" }],
    );
    expect(position?.old_path).toBe("old/name.ts");
    expect(position?.new_path).toBe("new/name.ts");
    expect(position?.new_line).toBe(3);
  });

  it("returns null when the file is absent from the diff", () => {
    expect(buildDiscussionPosition("missing.ts", 1, refs, [])).toBeNull();
  });
});
