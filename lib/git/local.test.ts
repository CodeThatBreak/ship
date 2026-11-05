import { describe, expect, it, vi } from "vitest";
import { LocalGit } from "./local";
import type { GitRunner } from "./gitRunner";

type GitArgs = readonly string[];

type FakeGit = {
  run: ReturnType<typeof vi.fn>;
};

/**
 * Build a fake GitRunner that dispatches on the git subcommand+ref patterns
 * localBranchState issues (rev-parse / rev-list / diff), so tests can control
 * branch existence, base refs and remote sync without a real repo.
 */
function fakeGit(handlers: Record<string, (args: GitArgs) => string>): FakeGit {
  const lookup = (args: GitArgs): Promise<{ stdout: string; stderr: string }> => {
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (args.includes(pattern)) {
        return Promise.resolve({ stdout: handler(args), stderr: "" });
      }
    }
    throw new Error(`git exited 128: ${args.join(" ")}`);
  };
  return { run: vi.fn(lookup) };
}

/** Command lines that must fail (non-zero exit). */
function failingFakeGit(failPatterns: string[], handlers: Record<string, (args: GitArgs) => string> = {}): FakeGit {
  const lookup = (args: GitArgs): Promise<{ stdout: string; stderr: string }> => {
    if (failPatterns.some((p) => args.includes(p))) {
      throw new Error(`git exited 128: ${args.join(" ")}`);
    }
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (args.includes(pattern)) {
        return Promise.resolve({ stdout: handler(args), stderr: "" });
      }
    }
    throw new Error(`git exited 128: ${args.join(" ")}`);
  };
  return { run: vi.fn(lookup) };
}

const BRANCH = "feature/fix";
const ORIGIN_REF = `origin/${BRANCH}`;

/** happy-path dispatch: branch exists, base resolves to origin/main. */
const defaultHandlers = {
  main: () => "abc123",
  "origin/main": () => "def456",
  [BRANCH]: () => "111222",
  "origin/main..feature/fix": () => "",
  "feature/fix..origin/main": () => "",
  // both `diff` invocations share the range; only the parsed fields differ
  "origin/main...feature/fix": () => "",
};

describe("LocalGit.localBranchState — unpushedAhead (§6A push state)", () => {
  it("missing branch → none state with unpushedAhead = 0", async () => {
    const git = failingFakeGit([BRANCH]);
    const local = new LocalGit(git as unknown as GitRunner);
    const state = await local.localBranchState("/repo", BRANCH, "main");
    expect(state.exists).toBe(false);
    expect(state.unpushedAhead).toBe(0);
    expect(state.pushed).toBe(false);
  });

  it("missing origin/<branch> ⇒ every branch commit is unpushed", async () => {
    const git = failingFakeGit([ORIGIN_REF], {
      ...defaultHandlers,
      // origin/feature/fix absent: does not exist; local branch commits ahead of base
      "origin/main..feature/fix": () => "4",
    });
    const local = new LocalGit(git as unknown as GitRunner);
    const state = await local.localBranchState("/repo", BRANCH, "main");
    expect(state.exists).toBe(true);
    expect(state.pushed).toBe(false);
    expect(state.commitsAhead).toBe(4);
    expect(state.unpushedAhead).toBe(4);
  });

  it("tip equality (origin/<branch> current) ⇒ unpushedAhead = 0 even though pushed", async () => {
    const git = fakeGit({
      ...defaultHandlers,
      "origin/main..feature/fix": () => "2",
      [ORIGIN_REF]: () => "111222",
      // origin/<branch>..branch is empty: remote tip == local tip
      [`origin/${BRANCH}..${BRANCH}`]: () => "0",
    });
    const local = new LocalGit(git as unknown as GitRunner);
    const state = await local.localBranchState("/repo", BRANCH, "main");
    expect(state.exists).toBe(true);
    expect(state.pushed).toBe(true);
    expect(state.unpushedAhead).toBe(0);
  });

  it("stale origin/<branch> behind the local tip ⇒ unpushedAhead > 0 while pushed exists", async () => {
    const git = fakeGit({
      ...defaultHandlers,
      "origin/main..feature/fix": () => "2",
      [ORIGIN_REF]: () => "999aaa",
      [`origin/${BRANCH}..${BRANCH}`]: () => "2",
    });
    const local = new LocalGit(git as unknown as GitRunner);
    const state = await local.localBranchState("/repo", BRANCH, "main");
    expect(state.exists).toBe(true);
    expect(state.pushed).toBe(true);
    expect(state.unpushedAhead).toBe(2);
  });

  it("unpushedAhead is independent of commitsAhead against the base", async () => {
    const git = fakeGit({
      ...defaultHandlers,
      "origin/main..feature/fix": () => "5",
      [ORIGIN_REF]: () => "999aaa",
      [`origin/${BRANCH}..${BRANCH}`]: () => "3",
      [`feature/fix..origin/main`]: () => "1",
    });
    const local = new LocalGit(git as unknown as GitRunner);
    const state = await local.localBranchState("/repo", BRANCH, "main");
    expect(state.commitsAhead).toBe(5);
    expect(state.commitsBehind).toBe(1);
    expect(state.unpushedAhead).toBe(3);
  });
});
