/**
 * Architecture (source-scan, `serverOnlyPolicy.test.ts` pattern): no raw
 * `UPDATE nodes SET status` (or `attempt_id`) write outside the transition
 * authority (engine overhaul step 02; decision Q6).
 *
 * Starts as `test.fails` with the frozen known-offender list below — the
 * modules the step-02 transition-authority migration rewrites. Each offender's
 * removal SHRINKS the list; the list is shrink-only (nothing is ever added —
 * a new raw write fails the suite, not just code review).
 *
 * Scans the source text, not the DB — this is a static gate, not a runtime one.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const ENGINE_ROOT = path.join(repoRoot, "lib/engine");

/**
 * Frozen known offenders (step 02 transition-authority migration targets).
 * SHRINK-ONLY: a step removes an entry when it routes that module's status
 * writes through the authority. Adding an entry is forbidden — a NEW raw
 * writer fails this list's diff.
 *
 * Each entry: the module, and why it holds a raw status write today.
 */
const FROZEN_OFFENDERS: readonly string[] = [
  "lib/engine/flowEngine.ts", // finishFanout/finishSplit/bg() catch + setNodeStatus/claimNode wrappers
  "lib/engine/nodes/shared/nodeSupport.ts", // claim/transition/patchIfAttempt duplicates
  "lib/engine/runtime/edgeActivator.ts", // stage catch + loop-reset/skip propagation setNodeStatus
  "lib/engine/runtime/fanout/stepFlowManager.ts", // fan-out aggregate status writes
  "lib/engine/runtime/nodeStore.ts", // claim/setStatus (the authority absorbs these)
  "lib/engine/runtime/split/splitManager.ts", // split join/skipUnit status writes
];

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

// A raw node-status/attempt write: a SQL UPDATE against nodes touching
// status/attempt_id. Read SQL (SELECT … status) never matches — the pattern
// requires the UPDATE verb.
const RAW_WRITE = /UPDATE\s+nodes\s+SET\s+[^;]*\b(status|attempt_id)\b/i;

const offenders = (): string[] => {
  const found: string[] = [];
  for (const abs of walk(ENGINE_ROOT)) {
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    const text = fs.readFileSync(abs, "utf8");
    if (RAW_WRITE.test(text)) found.push(rel);
  }
  return found.sort();
};

describe("noRawNodeStatusWrite", () => {
  // OVERHAUL: flip in step 02 (passes with zero offenders once the authority owns every write)
  it.fails("no raw nodes.status/attempt_id write outside the transition authority", () => {
    expect(offenders()).toEqual([]);
  });

  it("the frozen offender list only shrinks (current offenders match the freeze)", () => {
    // every offender found today must be on the frozen list — a NEW raw writer
    // that isn't frozen fails here loudly (shrink-only ratchet)
    expect(offenders()).toEqual([...FROZEN_OFFENDERS].sort());
  });
});
