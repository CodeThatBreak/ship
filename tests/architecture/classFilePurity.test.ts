/**
 * Architecture (source-scan): a `lib/**` file that exports a class exports
 * ONLY that class (engine overhaul §12 — class files are pure). No
 * module-scope `function` declarations, no module-scope runtime `const`/`let`,
 * no exported `interface`/`type` — those live in `constants/`, `types/`,
 * `schema.ts`/`schemas/`, `utils/` with relevant names.
 *
 * The gate is `lib/**`-wide. Step 09 emptied it for `lib/engine/**` — every
 * engine class file is pure (zero tolerance from here on: any NEW offender,
 * engine or not, fails). The remaining frozen offenders are all NON-engine
 * (`lib/db`, `lib/git`, `lib/integrations`, service modules) — shrink-only,
 * flagged for follow-up work rather than fixed in the overhaul diff.
 *
 * Scans the source text — static gate, not runtime.
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
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Frozen offenders (shrink-only) — the step-09 scan result, non-engine only.
 * A `lib/**` class file is impure when it ALSO exports a module-scope
 * function, a runtime const/let, or an interface/type. Adding an entry is
 * forbidden.
 */
const FROZEN_OFFENDERS: readonly string[] = [
  "lib/artifacts/artifactService.ts",
  "lib/comments/commentService.ts",
  "lib/config.ts",
  "lib/contracts/contractService.ts",
  "lib/db/database.ts",
  "lib/db/rowDecodeError.ts",
  "lib/db/stores/gitlabInstanceStore.ts",
  "lib/db/stores/jiraInstanceStore.ts",
  "lib/db/templateSeeder.ts",
  "lib/errors.ts",
  "lib/git/branchName.ts",
  "lib/git/depPolicy.ts",
  "lib/git/gitRunner.ts",
  "lib/git/local.ts",
  "lib/git/workspacePaths.ts",
  "lib/git/worktreeSetup.ts",
  "lib/git/worktrees.ts",
  "lib/groupEvents.ts",
  "lib/integrations/cursor/client.ts",
  "lib/integrations/cursor/credentials.ts",
  "lib/integrations/cursorSdk.ts",
  "lib/integrations/gitlab/client.ts",
  "lib/integrations/gitlab/gitHost.ts",
  "lib/integrations/localAgent/agent.ts",
  "lib/jsonata/eval.ts",
  "lib/modelCatalog/modelCatalogService.ts",
  "lib/net/readCappedBody.ts",
  "lib/repos/repoService.ts",
  "lib/settings/settingsService.ts",
  "lib/status/statusService.ts",
];

const exportedClasses = (text: string): number =>
  [...text.matchAll(/export\s+(?:abstract\s+)?class\s+\w+/g)].length;

/** A class file is impure when it exports anything besides the class. */
const isImpure = (text: string): boolean => {
  if (/^export\s+(?:async\s+)?function\s+\w+/m.test(text)) return true;
  if (/^(?:async\s+)?function\s+\w+/m.test(text)) return true; // local module-scope function
  if (/^export\s+const\s+\w+\s*=/m.test(text)) return true; // runtime const (not type-only)
  if (/^export\s+(?:interface|type)\s+\w+/m.test(text)) return true;
  return false;
};

const offenders = (): string[] => {
  const found: string[] = [];
  for (const abs of walk(LIB_ROOT)) {
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    const text = fs.readFileSync(abs, "utf8");
    if (exportedClasses(text) === 0) continue; // only class-exporting files
    if (isImpure(text)) found.push(rel);
  }
  return found.sort();
};

describe("classFilePurity", () => {
  it("no impure class file beyond the frozen non-engine offenders (engine is clean; zero tolerance for new files)", () => {
    expect(offenders()).toEqual([...FROZEN_OFFENDERS].sort());
  });
});
