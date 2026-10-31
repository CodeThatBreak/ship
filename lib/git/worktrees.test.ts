import { describe, expect, it } from "vitest";
import {
  parseWorktreeList,
  sanitizeWorktreeName,
  worktreeBranchName,
} from "./worktrees";

describe("worktrees helpers", () => {
  it("parses NUL-delimited porcelain output", () => {
    const raw = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /wt/one",
      "HEAD def456",
      "branch refs/heads/bugfix/x",
      "",
    ].join("\0");
    const parsed = parseWorktreeList(raw, { nulDelimited: true });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.isMainWorktree).toBe(true);
    const branchWt = parsed[1];
    if (!branchWt) throw new Error("expected branch worktree entry");
    expect(worktreeBranchName(branchWt)).toBe("bugfix/x");
  });

  it("sanitizes worktree directory names", () => {
    expect(sanitizeWorktreeName("  Fix  Login Bug! ")).toBe("fix-login-bug");
    expect(sanitizeWorktreeName("x".repeat(60)).length).toBe(48);
  });

  it("returns empty lists for empty porcelain", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });
});
