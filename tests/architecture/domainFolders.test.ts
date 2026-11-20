/**
 * Architecture (source-scan): within `lib/engine/**` non-test files, domain
 * values live in their folders — Zod schema definitions only in
 * `schema.ts`/`schemas/`, exported types only in `types/`, exported constants
 * only in `constants/` (engine overhaul §12; AGENTS §2.7).
 *
 * Scoped to the step-04 contract work: `plan/schema.ts`'s `withStepIds`
 * function (the one function allowed a schema file — it IS a schema home) and
 * the remaining kind schemas still parked inline. The decision/http/script
 * node-def entries were removed in step 04 — their schemas now live in each
 * kind's `schema.ts` / `utils/`. Adding an entry is forbidden.
 *
 * Scans the source text — static gate, not runtime.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE_ROOT = path.join(repoRoot, "lib/engine");

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

const inSchemaHome = (rel: string): boolean =>
  /\/schemas?\//.test(rel) || path.basename(rel) === "schema.ts";

/**
 * Frozen offenders — EMPTY since step 09: every inline Zod schema in
 * `lib/engine/**` lives in its `schema.ts`/`schemas/` home. From here on a
 * NEW inline schema outside a schema home fails the suite.
 */
const FROZEN_SCHEMA_OFFENDERS: readonly string[] = [];

// An inline Zod schema definition: `const X = z.<something>` at module scope
// (exported or not). `schema.ts`/`schemas/` files are exempt by location.
const INLINE_ZOD = /^\s*(?:export\s+)?const\s+\w+\s*=\s*z\./m;
// Also catch `readonly inputSchema = z.` / `outputSchema = z.` class-member
// inline schemas (the node-def pattern the step names).
const CLASS_MEMBER_ZOD = /readonly\s+(?:inputSchema|outputSchema)\s*=\s*z\./;

const schemaOffenders = (): string[] => {
  const found = new Set<string>();
  for (const abs of walk(ENGINE_ROOT)) {
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    if (inSchemaHome(rel)) continue;
    const text = fs.readFileSync(abs, "utf8");
    if (INLINE_ZOD.test(text) || CLASS_MEMBER_ZOD.test(text)) found.add(rel);
  }
  return [...found].sort();
};

describe("domainFolders", () => {
  it("no inline Zod schema outside schema.ts/schemas/ beyond the frozen offenders", () => {
    expect(schemaOffenders()).toEqual([...FROZEN_SCHEMA_OFFENDERS].sort());
  });
});
