/**
 * Architecture (source-scan): no `better-sqlite3` import under `lib/`
 * (step 01; the migration script `scripts/migrate-sqlite-to-pg.mjs` is the
 * only sanctioned reader and lives outside lib/). Must PASS.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIB_ROOT = path.join(repoRoot, "lib");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
};

describe("noSqliteInLib", () => {
  it("no better-sqlite3 import under lib/", () => {
    const offenders: string[] = [];
    for (const abs of walk(LIB_ROOT)) {
      const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
      const text = fs.readFileSync(abs, "utf8");
      if (/from\s+["']better-sqlite3["']|require\(["']better-sqlite3["']\)/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
