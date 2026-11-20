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
 * Frozen giants (append-frozen, shrink-only). Each leaves the list when the
 * step that migrates it shrinks it under the ceiling. NOTHING is ever added.
 *
 * Step 09 close-out: every giant was decomposed except ONE documented
 * exception — `templateStore.ts`, the template persistence store, whose
 * decomposition is deferred (tracked as follow-up work); it may shrink but
 * never grow.
 */
const FROZEN_GIANTS: readonly string[] = [
  "lib/engine/templates/templateStore.ts", // 1268 — the one documented step-09 exception (store decomposition deferred)
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
