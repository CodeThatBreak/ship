import { describe, expect, it, vi } from "vitest";
import {
  Worktrees,
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

describe("Worktrees branch reuse (Task 20)", () => {
  it("refuses to switch a dirty reused worktree (CR-107)", async () => {
    const wt = new Worktrees();
    const switchBranch = (
      wt as unknown as {
        switchWorktreeBranch: (
          dir: string,
          branch: string,
          base?: string,
        ) => Promise<{ headBranch: string; switched: boolean; reason?: string }>;
      }
    ).switchWorktreeBranch.bind(wt);

    const isDirty = vi.spyOn(wt, "isWorktreeDirty").mockResolvedValue(true);
    vi.spyOn(wt, "headBranch").mockResolvedValue("feature/current");

    const result = await switchBranch("/tmp/wt", "feature/other");
    expect(result.switched).toBe(false);
    expect(result.reason).toMatch(/uncommitted/i);
    expect(result.headBranch).toBe("feature/current");
    expect(isDirty).toHaveBeenCalledWith("/tmp/wt");
  });
});
