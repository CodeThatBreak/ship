/**
 * Architecture (source-scan, `serverOnlyPolicy.test.ts` pattern): no raw
 * `nodes.status` / `attempt_id` write outside the transition authority
 * (engine overhaul step 02; decision Q6 — flipped green in step 02).
 *
 * The transition authority (`lib/engine/runtime/transitions/`) is the ONLY
 * writer of node status and attempt tokens (Invariant 1). This gate scans the
 * source text — raw SQL UPDATEs, Prisma node-update calls carrying status /
 * attemptId, and node `setStatus(` calls — so a smuggled writer fails the
 * suite, not just code review. The runtime mirror is the authority's declared
 * table (see `transitionTable.test.ts` and the transition-log assert).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const ENGINE_ROOT = path.join(repoRoot, "lib/engine");
const AUTHORITY_ROOT = path.join(repoRoot, "lib/engine/runtime/transitions");

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

// A raw node-status/attempt write — any of three shapes:
//  1. SQL UPDATE against nodes touching status/attempt_id (reads never match —
//     the pattern requires the UPDATE verb)
//  2. a Prisma node.update/node.updateMany whose data/where carries
//     status or attemptId
//  3. a node setStatus( call (nodeStore/node `.setStatus` — plan-step
//     checklist `planSteps.setStatus` is a different domain and never matches)
const RAW_WRITE = /UPDATE\s+nodes\s+SET\s*[^;]*\b(status|attempt_id)\b/i;
const PRISMA_WRITE = /\.node\.update(?:Many)?\s*\([\s\S]{0,300}?\b(status|attemptId)\s*:/;
const SETSTATUS_WRITE = /\bnode\w*\.setStatus\s*\(/;

const offenders = (): string[] => {
  const found: string[] = [];
  for (const abs of walk(ENGINE_ROOT)) {
    if (abs.startsWith(AUTHORITY_ROOT)) continue; // the authority itself
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    const text = fs.readFileSync(abs, "utf8");
    if (RAW_WRITE.test(text) || PRISMA_WRITE.test(text) || SETSTATUS_WRITE.test(text)) {
      found.push(rel);
    }
  }
  return found.sort();
};

describe("noRawNodeStatusWrite", () => {
  it("no raw nodes.status/attempt_id write outside the transition authority", () => {
    expect(offenders()).toEqual([]);
  });

  it("the gate stays at zero — any new writer fails here loudly", () => {
    // a NEW raw writer fails the test above; this second assertion exists so
    // the empty-list contract is pinned even if the first is skipped
    expect(offenders().length).toBe(0);
  });
});
