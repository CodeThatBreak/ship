import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("worktree wiring tripwires", () => {
  it("keeps lib/git modules free of db/engine imports", () => {
    for (const file of ["worktrees.ts", "depPolicy.ts", "worktreeSetup.ts"]) {
      const src = fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(/from\s+["'].*(\.\.\/db|\.\.\/engine|@\/)/.test(src)).toBe(false);
    }
  });

  it("keeps the local runner ensure chokepoint wired", () => {
    // step-09 decomposition: the AgentRunner class moved to
    // `agentRunner/agentRunner.ts` (the `agentRunner.ts` module is the pure
    // pin) — the tripwire follows the class file where the wiring lives
    const runnerSrc = fs.readFileSync(
      new URL("../engine/harness/agentRunner/agentRunner.ts", import.meta.url),
      "utf8",
    );
    expect(runnerSrc.includes("this.worktrees.ensureForRun(")).toBe(true);
    const localStart = runnerSrc.indexOf('if (port.execMode === "local") {');
    expect(localStart).toBeGreaterThan(-1);
    const localEnd = runnerSrc.indexOf("} else {", localStart);
    const localBlock = runnerSrc.slice(localStart, localEnd);
    expect(localBlock.includes("this.worktrees.ensureForRun(")).toBe(true);
  });
});
