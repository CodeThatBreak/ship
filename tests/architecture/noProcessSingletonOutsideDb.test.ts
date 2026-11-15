/**
 * Architecture (source-scan, decision Q9): `processSingleton` survives ONLY
 * in the DB client (`lib/db/prismaClient.ts` — Prisma's connection pool,
 * HMR-safe). Every other service is constructor-injected via the composition
 * root (`lib/composition/container.ts`), which lands incrementally through
 * step 09.
 *
 * Starts as `test.fails` with the frozen 39-site inventory from the step doc.
 * Each later step shrinks the list as it migrates a service; the list is
 * shrink-only — a NEW `processSingleton` call site fails the suite.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIB_ROOT = path.join(repoRoot, "lib");

/** The only sanctioned `processSingleton` call site (Q9): the Prisma client. */
const ALLOWED = "lib/db/prismaClient.ts";

/**
 * Frozen known call sites (step doc task 8 — the 39-site inventory, mapped to
 * real module paths). SHRINK-ONLY: a step removes an entry when it
 * constructor-injects that service from the composition root. Adding an entry
 * is forbidden.
 */
const FROZEN_OFFENDERS: readonly string[] = [
  "lib/db/app.ts", // the `db` facade singleton + lazy background-workers side effect (Q10)
  "lib/db/dbAccess.ts", // the bound-db slot accessor
  "lib/db/rowGatewayAccess.ts", // the bound-row-gateway slot accessor
  "lib/git/gitRunner.ts",
  "lib/git/worktrees.ts",
  "lib/git/worktreeSetup.ts",
  "lib/git/local.ts", // localGit
  "lib/git/depPolicy.ts", // depPolicies
  "lib/engine/secretStore.ts",
  "lib/modelCatalog/modelCatalogService.ts",
  "lib/comments/commentService.ts",
  "lib/settings/settingsService.ts",
  "lib/repos/repoService.ts",
  "lib/artifacts/artifactService.ts",
  "lib/status/statusService.ts",
  "lib/contracts/contractService.ts",
  "lib/integrations/cursorSdk.ts",
  "lib/integrations/cursor/client.ts", // cursorClient
  "lib/integrations/cursor/credentials.ts", // cursorCredentials
  "lib/integrations/jira/singleton.ts", // jira
  "lib/integrations/gitlab/singleton.ts", // gitLab
  "lib/integrations/localAgent/agent.ts", // localAgent
  "lib/localApi/token.ts", // localApi token
  "lib/engine/nodes/declarativeRegistry.ts", // declarativeKindRegistry/declarativeDefCache
  "lib/engine/tasks/taskService.ts",
  "lib/engine/tasks/liveTaskFeed.ts", // liveTaskFeed
  "lib/engine/runtime/nodeStore.ts",
  "lib/engine/runtime/flowReconciler.ts", // reconciler
  "lib/engine/flowEngine.ts",
  "lib/engine/runtime/flowPoller.ts",
  "lib/engine/runtime/nodeAttemptRegistry.ts",
  "lib/engine/runtime/fanout/stepFlowManager.ts", // stepFlows
  "lib/engine/runtime/worktreeLifecycle.ts", // worktreeManager
  "lib/engine/runtime/hookStore.ts",
  "lib/engine/runtime/fanout/mergeArena.ts",
  "lib/engine/runtime/split/splitManager.ts",
  "lib/engine/graph/graphService.ts",
  "lib/engine/runtime/commentStore.ts",
];

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
};

const offenders = (): string[] => {
  const found: string[] = [];
  for (const abs of walk(LIB_ROOT)) {
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    if (rel === ALLOWED) continue;
    if (rel === "lib/singleton.ts") continue; // the registry itself
    const text = fs.readFileSync(abs, "utf8");
    if (/processSingleton\(/.test(text)) found.push(rel);
  }
  return found.sort();
};

describe("noProcessSingletonOutsideDb", () => {
  // OVERHAUL: flips in step 09 (passes with zero offenders outside lib/db/prismaClient.ts)
  it.fails("no processSingleton outside the DB client", () => {
    expect(offenders()).toEqual([]);
  });

  it("the frozen offender list only shrinks (current offenders ⊆ the freeze)", () => {
    const frozen = new Set(FROZEN_OFFENDERS);
    const unexpected = offenders().filter((o) => !frozen.has(o));
    expect(unexpected).toEqual([]);
  });
});
