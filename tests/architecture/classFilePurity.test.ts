/**
 * Architecture (source-scan): a `lib/**` file that exports a class exports
 * ONLY that class (engine overhaul §12 — class files are pure). No
 * module-scope `function` declarations, no module-scope runtime `const`/`let`,
 * no exported `interface`/`type` — those live in `constants/`, `types/`,
 * `schema.ts`/`schemas/`, `utils/` with relevant names.
 *
 * NEW files get ZERO tolerance (not being on the list = must pass). The
 * current offenders are frozen below — the full step-00 scan, SHRINK-ONLY:
 * each step removes entries as it moves helpers/consts/types into their
 * domain folders; nothing is ever added. The step-00 named offenders
 * (sdlcChain MANUAL_* consts, hookStore TTL consts, buildNode splitUnitItemOf,
 * flowEngine helpers) are annotated inline.
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
 * Frozen offenders (shrink-only) — the full step-00 scan result. A `lib/**`
 * class file is impure when it ALSO exports a module-scope function, a runtime
 * const/let, or an interface/type. Adding an entry is forbidden.
 */
const FROZEN_OFFENDERS: readonly string[] = [
  "lib/artifacts/artifactService.ts",
  "lib/comments/commentService.ts",
  "lib/config.ts",
  "lib/contracts/contractService.ts",
  "lib/db/rowDecodeError.ts",
  "lib/db/rows.ts",
  "lib/db/stores/gitlabInstanceStore.ts",
  "lib/db/stores/jiraInstanceStore.ts",
  "lib/engine/flowEngine.ts", // module helpers
  "lib/engine/graph/graphService.ts",
  "lib/engine/harness/agentRunner.ts",
  "lib/engine/harness/pricingSource.ts",
  "lib/engine/harness/toolPairer.ts",
  "lib/engine/harness/usageTracker.ts",
  "lib/engine/nodes/chains/sdlcChain.ts", // MANUAL_* consts
  "lib/engine/nodes/declarativeRegistry.ts",
  "lib/engine/nodes/kinds/build/branchStore.ts",
  "lib/engine/nodes/kinds/build/buildNode.ts", // splitUnitItemOf
  "lib/engine/nodes/kinds/http/httpNode.ts",
  "lib/engine/nodes/kinds/mergeRequest/errors.ts",
  "lib/engine/nodes/kinds/mergeRequest/mergeRequestService.ts",
  "lib/engine/nodes/kinds/plan/planPrompt.ts",
  "lib/engine/nodes/kinds/plan/planStore.ts",
  "lib/engine/nodes/kinds/resolve/resolveContract.ts",
  "lib/engine/nodes/kinds/resolve/resolveEffects.ts",
  "lib/engine/nodes/kinds/script/scriptNode.ts",
  "lib/engine/nodes/registry.ts",
  "lib/engine/nodes/shared/agent/outputError/agentOutputError.ts",
  "lib/engine/nodes/shared/agentRunNode.ts",
  "lib/engine/nodes/shared/branchNamer.ts",
  "lib/engine/nodes/shared/declarativeNode.ts",
  "lib/engine/nodes/shared/mrTargetResolver.ts",
  "lib/engine/nodes/shared/nodeDefinition.ts",
  "lib/engine/nodes/shared/nodeRoles.ts",
  "lib/engine/nodes/shared/nodeSupport.ts",
  "lib/engine/nodes/shared/runContext.ts",
  "lib/engine/nodes/shared/split.ts",
  "lib/engine/nodes/shared/templateRenderer.ts",
  "lib/engine/ports/agentPort.ts",
  "lib/engine/ports/gitHost.ts",
  "lib/engine/ports/gitHostErrors.ts",
  "lib/engine/prompts/promptLibrary.ts",
  "lib/engine/prompts/promptPreview.ts",
  "lib/engine/runtime/commentIngestor.ts",
  "lib/engine/runtime/commentStore.ts",
  "lib/engine/runtime/fanout/stepFlowManager.ts",
  "lib/engine/runtime/flowFactory.ts",
  "lib/engine/runtime/flowPoller.ts",
  "lib/engine/runtime/flowReconciler.ts",
  "lib/engine/runtime/hookStore.ts", // TTL consts
  "lib/engine/runtime/nodeAttemptRegistry.ts",
  "lib/engine/runtime/nodeStore.ts",
  "lib/engine/runtime/planStepStore.ts",
  "lib/engine/runtime/split/splitManager.ts",
  "lib/engine/runtime/worktreeLifecycle.ts",
  "lib/engine/runtime/worktreeStatusService.ts",
  "lib/engine/secretStore.ts",
  "lib/engine/tasks/liveTaskFeed.ts",
  "lib/engine/tasks/providers/jira.ts",
  "lib/engine/tasks/registry.ts",
  "lib/engine/tasks/taskProvider.ts",
  "lib/engine/tasks/taskService.ts",
  "lib/engine/templates/templatePreviewService.ts",
  "lib/engine/templates/templateStore.ts",
  "lib/engine/templates/templateYaml.ts",
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
  it("no impure class file beyond the frozen offenders (zero tolerance for new files)", () => {
    expect(offenders()).toEqual([...FROZEN_OFFENDERS].sort());
  });
});
