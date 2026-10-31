import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("worktree wiring tripwires", () => {
  it("keeps lib/git modules free of db/engine imports", () => {
    for (const file of ["worktrees.ts", "dep-policy.ts", "worktree-setup.ts"]) {
      const src = fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(/from\s+["'].*(\.\.\/db|\.\.\/engine|@\/)/.test(src)).toBe(false);
    }
  });

  it("keeps the local runner ensure chokepoint wired", () => {
    const runnerSrc = fs.readFileSync(
      new URL("../engine/harness/agent-runner.ts", import.meta.url),
      "utf8",
    );
    expect(runnerSrc.includes("worktreeManager.ensureForRun(")).toBe(true);
    const localStart = runnerSrc.indexOf('if (port.execMode === "local") {');
    expect(localStart).toBeGreaterThan(-1);
    const localEnd = runnerSrc.indexOf("} else {", localStart);
    const localBlock = runnerSrc.slice(localStart, localEnd);
    expect(localBlock.includes("worktreeManager.ensureForRun(")).toBe(true);
  });
});
