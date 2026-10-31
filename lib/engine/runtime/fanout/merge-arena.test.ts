import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("mergeArena (Task 20)", () => {
  it("is registered with processSingleton (CR-059)", () => {
    const src = fs.readFileSync(new URL("./merge-arena.ts", import.meta.url), "utf8");
    expect(src).toMatch(/processSingleton\("mergeArena"/);
  });

  it("serializes arena git on parentFlowId, including deleteStepBranch (CR-008)", () => {
    const src = fs.readFileSync(new URL("./merge-arena.ts", import.meta.url), "utf8");
    expect(src).not.toContain("${args.parentFlowId}:${args.integrationBranch}");
    expect(src).toMatch(/const key = args\.parentFlowId;/);
    expect(src).toMatch(/deleteStepBranch\(parentFlowId[\s\S]*withLock\(parentFlowId/);
  });
});
