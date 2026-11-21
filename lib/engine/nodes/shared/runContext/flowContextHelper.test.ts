import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import type { FlowCtx } from "./types/flowContext";

const { FlowContextHelper } = await import("./flowContextHelper");

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-diffattr-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tmpDirs.map((d) => fs.promises.rm(d, { recursive: true, force: true })));
  tmpDirs.length = 0;
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

/**
 * A real repo on disk: `main` at the base commit, `feat/a` branched off it
 * with one agent commit. No remote — every capture resolves through the
 * local refs (the makeDiff local-first path).
 */
const seedRepo = (): { hub: string; mainSha: string } => {
  const hub = makeTmp();
  git(hub, "init", "-b", "main");
  git(hub, "config", "user.email", "test@devflow.local");
  git(hub, "config", "user.name", "DevFlow Test");
  fs.writeFileSync(path.join(hub, "base.txt"), "base\n");
  git(hub, "add", ".");
  git(hub, "commit", "-m", "base");
  git(hub, "checkout", "-b", "feat/a");
  fs.writeFileSync(path.join(hub, "agent.txt"), "agent work\n");
  git(hub, "add", ".");
  git(hub, "commit", "-m", "agent work");
  return { hub, mainSha: git(hub, "rev-parse", "main").trim() };
};

/** A minimal FlowCtx over the real repo — makeDiff reads flow/repo fields only. */
const ctxFor = (hub: string): FlowCtx =>
  ({
    flow: { id: "flw_diffattr", repoUrl: null, worktreeDir: null, executionMode: "local" },
    task: { id: "task_x", type: "generic", key: "BR-1", summary: "diff attribution test" },
    repo: { localPath: hub, defaultBranch: "main" },
  }) as unknown as FlowCtx;

describe("FlowContextHelper.makeDiff — attribution (Task 08)", () => {
  it("pins the agent projection at capture; a later user commit stays out of it while the whole-branch projection includes it", async () => {
    const { hub, mainSha } = seedRepo();
    const helper = new FlowContextHelper();
    const ctx = ctxFor(hub);

    // the finalize capture: the branch head == the agent's tip, the user
    // commit does not exist yet
    const atFinalize = await helper.makeDiff(ctx, "feat/a", { baseSha: mainSha });
    if (!atFinalize) throw new Error("the finalize capture failed");
    expect(atFinalize.attribution).toBe("agent");
    expect(atFinalize.baseSha).toBe(mainSha);
    expect(atFinalize.headSha).toBe(git(hub, "rev-parse", "feat/a").trim());
    expect(atFinalize.raw).toContain("agent work");
    expect(atFinalize.alt?.attribution).toBe("all");
    expect(atFinalize.alt?.raw).toContain("agent work");

    // the user commits AFTER the run
    fs.writeFileSync(path.join(hub, "user.txt"), "user work\n");
    git(hub, "add", ".");
    git(hub, "commit", "-m", "user work");

    // the persisted finalize capture (the fact's content) excludes the user commit
    expect(atFinalize.raw).not.toContain("user work");
    // the refreshed capture sees the moved branch: the head anchor bumps and
    // the whole-branch projection includes the user commit
    const refreshed = await helper.makeDiff(ctx, "feat/a", { baseSha: mainSha });
    if (!refreshed) throw new Error("the refreshed capture failed");
    expect(refreshed.headSha).not.toBe(atFinalize.headSha);
    expect(refreshed.alt?.raw).toContain("user work");
    expect(refreshed.alt?.raw).toContain("agent work");
  });

  it("a worktree-only change produces the uncommitted variant (diffed against baseSha)", async () => {
    const hub = makeTmp();
    git(hub, "init", "-b", "main");
    git(hub, "config", "user.email", "test@devflow.local");
    git(hub, "config", "user.name", "DevFlow Test");
    fs.writeFileSync(path.join(hub, "base.txt"), "base\n");
    git(hub, "add", ".");
    git(hub, "commit", "-m", "base");
    const mainSha = git(hub, "rev-parse", "main").trim();
    git(hub, "checkout", "-b", "feat/b"); // branched, NOTHING committed
    fs.writeFileSync(path.join(hub, "wip.txt"), "uncommitted\n");

    const capture = await new FlowContextHelper().makeDiff(ctxFor(hub), "feat/b", { baseSha: mainSha });

    if (!capture) throw new Error("the capture failed");
    expect(capture.uncommitted).toBe(true);
    expect(capture.attribution).toBe("agent");
    expect(capture.baseSha).toBe(mainSha);
    // nothing committed — the head anchor is the commit the work sits on
    expect(capture.headSha).toBe(mainSha);
    expect(capture.raw).toContain("uncommitted");
  });

  it("no pinned base — the plain whole-branch capture, the pre-Task-08 shape", async () => {
    const { hub } = seedRepo();

    const capture = await new FlowContextHelper().makeDiff(ctxFor(hub), "feat/a");

    if (!capture) throw new Error("the capture failed");
    expect(capture.attribution).toBe("all");
    expect(capture.baseSha).toBeNull();
    expect(capture.headSha).toBe(git(hub, "rev-parse", "feat/a").trim());
    expect(capture.raw).toContain("agent work");
    expect(capture.alt).toBeUndefined();
    expect(capture.uncommitted).toBeUndefined();
  });
});