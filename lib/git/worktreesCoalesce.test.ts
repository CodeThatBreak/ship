import { describe, expect, it, vi } from "vitest";
import { Worktrees } from "./worktrees";
import type { GitRunner } from "./gitRunner";

describe("Worktrees listWorktrees coalescing (CR-218)", () => {
  it("fresh: true bypasses an in-flight scan", async () => {
    let resolveFirst: ((value: { stdout: string; stderr: string }) => void) | undefined;
    const first = new Promise<{ stdout: string; stderr: string }>((resolve) => {
      resolveFirst = resolve;
    });
    let calls = 0;
    const gitExec = {
      run: vi.fn(() => {
        calls += 1;
        return calls === 1 ? first : Promise.resolve({ stdout: "", stderr: "" });
      }),
    };

    const wt = new Worktrees(gitExec as unknown as GitRunner);
    const repo = "/tmp/repo";
    const shared = wt.listWorktrees(repo);
    const fresh = wt.listWorktrees(repo, { fresh: true });
    resolveFirst?.({ stdout: "", stderr: "" });
    await Promise.all([shared, fresh]);
    expect(calls).toBe(2);
  });
});
