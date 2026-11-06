/**
 * Architecture (source-scan): no `lib/engine/**` file over 450 lines
 * (engine overhaul §12 — "~400 is a hard ceiling for engine classes";
 * decision Q6).
 *
 * The current giants are frozen in the allowlist below. The list is
 * APPEND-FROZEN / SHRINK-ONLY: steps remove entries as they decompose the
 * god classes (target-architecture §12 table), and nothing is ever added —
 * a NEW giant (or an existing file growing past 450) fails the suite.
 *
 * Scans line counts, not behavior — static size gate.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE_ROOT = path.join(repoRoot, "lib/engine");

const LINE_CEILING = 450;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Frozen giants (append-frozen, shrink-only). The named god classes the
 * overhaul decomposes (flowEngine, stepFlowManager, splitManager,
 * pipelineNode, buildNode, resolveNode, edgeActivator) plus the other current
 * over-ceiling modules frozen at step 00. Each leaves the list when the step
 * that migrates it shrinks it under the ceiling. NOTHING is ever added.
 */
const FROZEN_GIANTS: readonly string[] = [
  "lib/engine/flowEngine.ts", // 1328 — facade carve-up (steps 02→07)
  "lib/engine/nodes/kinds/agent/agentNode.ts", // 576 — output pipeline migration (step 05)
  "lib/engine/nodes/kinds/build/buildNode.ts", // 569 — output pipeline migration (step 05)
  "lib/engine/nodes/kinds/pipeline/pipelineNode.ts", // 688 — GateWaitLoop/GateFixRunner split (step 05)
  "lib/engine/nodes/kinds/plan/planContract.ts", // 515 — contract dedup (step 05)
  "lib/engine/nodes/kinds/resolve/resolveNode.ts", // 722 — collaborator extraction (step 05)
  "lib/engine/nodes/shared/nodeSupport.ts", // 455 — authority funnel (step 02)
  "lib/engine/runtime/fanout/stepFlowManager.ts", // 1349 — Expander/Scheduler/Rollup split (step 07)
  "lib/engine/runtime/split/splitManager.ts", // 695 — Expander/Join/LinkageStore split (step 07)
  "lib/engine/runtime/worktreeLifecycle.ts", // 567 — worktree decomposition (step 03/05)
  "lib/engine/templates/templateLint.ts", // 712 — lint split as contract checks land (step 04)
  "lib/engine/templates/templateStore.ts", // 1268 — store decomposition (step 04+)
];

const giantsOver = (): string[] => {
  const found: string[] = [];
  for (const abs of walk(ENGINE_ROOT)) {
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    const lines = fs.readFileSync(abs, "utf8").split("\n").length;
    if (lines > LINE_CEILING) found.push(rel);
  }
  return found.sort();
};

describe("engineClassSize", () => {
  it("no lib/engine file over 450 lines beyond the frozen giants (shrink-only)", () => {
    expect(giantsOver()).toEqual([...FROZEN_GIANTS].sort());
  });

  it("the frozen giants only ever shrink (none grew past its frozen size)", () => {
    // a frozen giant may leave the list by shrinking under the ceiling; it may
    // NEVER grow. Pin each giant's current line count as its ceiling.
    const frozen = new Map<string, number>([
      ["lib/engine/flowEngine.ts", 1328],
      ["lib/engine/nodes/kinds/agent/agentNode.ts", 576],
      ["lib/engine/nodes/kinds/build/buildNode.ts", 569],
      ["lib/engine/nodes/kinds/pipeline/pipelineNode.ts", 688],
      ["lib/engine/nodes/kinds/plan/planContract.ts", 515],
      ["lib/engine/nodes/kinds/resolve/resolveNode.ts", 722],
      ["lib/engine/nodes/shared/nodeSupport.ts", 455],
      ["lib/engine/runtime/fanout/stepFlowManager.ts", 1349],
      ["lib/engine/runtime/split/splitManager.ts", 695],
      ["lib/engine/runtime/worktreeLifecycle.ts", 567],
      ["lib/engine/templates/templateLint.ts", 712],
      ["lib/engine/templates/templateStore.ts", 1268],
    ]);
    const over: string[] = [];
    for (const [rel, ceiling] of frozen) {
      const lines = fs.readFileSync(path.join(repoRoot, rel), "utf8").split("\n").length;
      if (lines > ceiling) over.push(`${rel} (${lines} > ${ceiling})`);
    }
    expect(over).toEqual([]);
  });
});
