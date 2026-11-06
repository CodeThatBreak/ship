/**
 * Architecture (source-scan): within `lib/engine/**` non-test files, domain
 * values live in their folders — Zod schema definitions only in
 * `schema.ts`/`schemas/`, exported types only in `types/`, exported constants
 * only in `constants/` (engine overhaul §12; AGENTS §2.7).
 *
 * Scoped to the step-04 contract work: the inline Zod schemas parked in the
 * decision/http/script/agent node defs and `plan/schema.ts`'s `withStepIds`
 * function. Those are frozen below (shrink-only); step 04 moves them into each
 * kind's `schema.ts` / `utils/` and removes the entries. A NEW inline schema
 * outside `schema.ts`/`schemas/` fails the suite.
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
 * Frozen offenders (shrink-only) — files with an inline Zod schema definition
 * outside a `schema.ts`/`schemas/` home at step 00. Step 04 moves the
 * decision/http/script/agent inline schemas into each kind's `schema.ts`;
 * `plan/schema.ts`'s `withStepIds` is the one function allowed a schema file
 * (it IS a schema home). Adding an entry is forbidden.
 */
const FROZEN_SCHEMA_OFFENDERS: readonly string[] = [
  "lib/engine/nodes/declarative.ts", // DeclarativeRowSchema boundary parse
  "lib/engine/nodes/declarativeSchemas.ts", // AgentDefSchema/DecisionDefSchema/HttpDefSchema/ScriptDefSchema — the declarative kind schemas, consolidated in step 04
  "lib/engine/nodes/kinds/decision/decisionNode.ts", // inline inputSchema/outputSchema
  "lib/engine/nodes/kinds/http/httpNode.ts", // inline inputSchema/outputSchema
  "lib/engine/nodes/kinds/resolve/resolveNode.ts", // inline schema (resolve kind)
  "lib/engine/nodes/kinds/review/reviewComments.ts", // reviewCommentItemSchema
  "lib/engine/nodes/kinds/script/scriptNode.ts", // inline inputSchema/outputSchema
  "lib/engine/nodes/kinds/start/startNode.ts", // inline start-contract schema
  "lib/engine/nodes/shared/capabilities.ts", // DEFAULT_FANOUT_OUTPUT (z. schema const)
  "lib/engine/nodes/shared/split.ts", // splitConsumeSchema/splitParallelMaxSchema
  "lib/engine/runtime/split/splitManager.ts", // DEFAULT_SPLIT_OUTPUT
  "lib/engine/templates/nodeConfig.ts", // mcpSourcesSchema
];

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
