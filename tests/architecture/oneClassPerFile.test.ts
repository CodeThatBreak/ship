/**
 * Architecture (source-scan): one exported class per file in `lib/engine/**`,
 * and the file is named after that class (engine overhaul §12; AGENTS §3.2).
 *
 * New files get ZERO tolerance. The existing offenders are frozen below
 * (shrink-only): multi-class modules and single-class modules whose file name
 * doesn't match the class. A NEW offender (not frozen) fails the suite.
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

const exportedClasses = (text: string): string[] =>
  [...text.matchAll(/export\s+(?:abstract\s+)?class\s+(\w+)/g)].map((m) => m[1]);

/**
 * Frozen offenders (shrink-only). Multi-class modules and misnamed single-class
 * modules that predate the rule; each is renamed/split by the step that migrates
 * it. Adding an entry is forbidden.
 */
const FROZEN_MULTI_CLASS: readonly string[] = [
  "lib/engine/nodes/declarativeRegistry.ts",
  "lib/engine/nodes/kinds/mergeRequest/errors.ts",
  "lib/engine/nodes/shared/declarativeNode.ts",
  "lib/engine/nodes/shared/split.ts",
  "lib/engine/ports/agentErrors.ts",
  "lib/engine/ports/gitHostErrors.ts",
  "lib/engine/runtime/split/splitManager.ts",
];

const FROZEN_MISNAMED: readonly string[] = [
  "lib/engine/nodes/kinds/agent/agentNode.ts",
  "lib/engine/nodes/kinds/decision/decisionNode.ts",
  "lib/engine/nodes/kinds/http/httpNode.ts",
  "lib/engine/nodes/kinds/plan/planContext.ts",
  "lib/engine/nodes/kinds/plan/planContract.ts",
  "lib/engine/nodes/kinds/plan/planPrompt.ts",
  "lib/engine/nodes/kinds/plan/planSplit.ts",
  "lib/engine/nodes/kinds/resolve/resolveContract.ts",
  "lib/engine/nodes/kinds/script/scriptNode.ts",
  "lib/engine/nodes/registry.ts",
  "lib/engine/nodes/shared/nodeRoles.ts",
  "lib/engine/nodes/shared/runContext.ts",
  "lib/engine/ports/agentPort.ts",
  "lib/engine/ports/gitHost.ts",
  "lib/engine/runtime/flowReconciler.ts",
  "lib/engine/runtime/worktreeLifecycle.ts",
  "lib/engine/tasks/providers/jira.ts",
  "lib/engine/tasks/registry.ts",
  "lib/engine/templates/templateYaml.ts",
];

const camel = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

const scan = (): { multiClass: string[]; misnamed: string[] } => {
  const multiClass: string[] = [];
  const misnamed: string[] = [];
  for (const abs of walk(ENGINE_ROOT)) {
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    const classes = exportedClasses(fs.readFileSync(abs, "utf8"));
    if (classes.length > 1) {
      multiClass.push(rel);
    } else if (classes.length === 1) {
      const base = path.basename(abs, ".ts");
      if (base !== classes[0] && base !== camel(classes[0])) misnamed.push(rel);
    }
  }
  return { multiClass: multiClass.sort(), misnamed: misnamed.sort() };
};

describe("oneClassPerFile", () => {
  it("no new multi-class module beyond the frozen offenders", () => {
    expect(scan().multiClass).toEqual([...FROZEN_MULTI_CLASS].sort());
  });

  it("no new misnamed single-class module beyond the frozen offenders", () => {
    expect(scan().misnamed).toEqual([...FROZEN_MISNAMED].sort());
  });
});
