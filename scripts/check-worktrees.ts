/**
 * Sanity checks for worktree support: Phase 1 — the porcelain parser, name
 * hygiene, path helpers, and the real-git create/remove lifecycle (preflight,
 * merged-only branch cleanup, crash-recovery reuse). Phase 2 — the dep-policy
 * resolution table and the setup executor (clone gate, fallback install,
 * config sync, shared-dir symlinks, non-fatal failures). Phase 3 — the
 * flow-card worktree-status endpoint (registered/branch/dirty/ahead/behind).
 * Phase 4 — the runner-facing ensure (Option B: pins win, plan runs stay on
 * the hub, unpinned mutating runs ensure the flow worktree) plus a
 * source-level tripwire keeping the agent-runner chokepoint wired.
 *
 * Run: npx tsx scripts/check-worktrees.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseWorktreeList,
  samePath,
  sanitizeWorktreeName,
  worktreeBranchName,
  worktrees,
} from "../lib/git/worktrees";
import {
  DEFAULT_SYNC_GLOBS,
  depPolicies,
  type DepPolicy,
  type RepoDepOverrides,
} from "../lib/git/dep-policy";
import { worktreeSetup } from "../lib/git/worktree-setup";

const git = (args: string[], cwd?: string) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Same as git(), but returns success instead of throwing (expected-failure probes). */
const gitFails = (args: string[], cwd?: string): boolean => {
  try {
    git(args, cwd);
    return false;
  } catch {
    return true;
  }
};

// ── purity guard: lib/git/* must stay free of db/engine imports ─────────────
for (const file of ["worktrees.ts", "dep-policy.ts", "worktree-setup.ts"]) {
  const src = fs.readFileSync(new URL(`../lib/git/${file}`, import.meta.url), "utf8");
  assert.ok(!/from\s+["'].*(\.\.\/db|\.\.\/engine|@\/)/.test(src), `${file} must not import db/engine layers`);
}

// ── source guard: the runner ensure chokepoint must stay wired (Option B) ────
// The runner is the ONE place every unpinned mutating agent run passes through;
// these textual assertions tripwire against the wiring being dropped later.
{
  const runnerSrc = fs.readFileSync(new URL("../lib/engine/nodes/base/agent-runner.ts", import.meta.url), "utf8");
  assert.ok(
    runnerSrc.includes("worktreeManager.ensureForRun("),
    "agent-runner.ts must call worktreeManager.ensureForRun — the runner-side ensure chokepoint was unwired"
  );
  const localStart = runnerSrc.indexOf('if (port.execMode === "local") {');
  assert.ok(localStart !== -1, 'agent-runner.ts lost its port.execMode === "local" branch');
  const localEnd = runnerSrc.indexOf("} else {", localStart);
  assert.ok(localEnd !== -1, "agent-runner.ts local branch lost its else (cloud spec assembly)");
  const localBlock = runnerSrc.slice(localStart, localEnd);
  assert.ok(
    localBlock.includes("worktreeManager.ensureForRun("),
    'worktreeManager.ensureForRun must sit inside the execMode === "local" branch (plan/cloud runs must not ensure)'
  );
  assert.ok(
    localBlock.includes("spec.cwd = input.cwd ?? ensured.cwd"),
    "the local branch must assign spec.cwd = input.cwd ?? ensured.cwd (the node pin wins, else the ensured worktree)"
  );
  // script-only flows are first-class: cwd:"workspace" curls through the same ensure
  const scriptSrc = fs.readFileSync(new URL("../lib/engine/nodes/script/script-node.ts", import.meta.url), "utf8");
  assert.ok(
    scriptSrc.includes("worktreeManager.ensureFlowWorktree("),
    'script-node.ts must route cwd:"workspace" through worktreeManager.ensureFlowWorktree'
  );
}

// ── isolated git fixture (used by the policy + lifecycle checks below) ──────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-wt-"));
const hub = path.join(tmp, "hub");
const wsDir = path.join(tmp, "workspaces");
const wtDir = path.join(wsDir, "flow_1");

// ── porcelain parser: NUL-delimited (the -z format) ─────────────────────────
const nulRaw = [
  "worktree /repo",
  "HEAD abc123",
  "branch refs/heads/main",
  "",
  "worktree /wt/one",
  "HEAD def456",
  "branch refs/heads/bugfix/x",
  "",
  "worktree /wt/detached",
  "HEAD 000111",
  "prunable",
  "",
].join("\0");
const parsed = parseWorktreeList(nulRaw, { nulDelimited: true });
assert.equal(parsed.length, 3);
assert.equal(parsed[0].path, "/repo");
assert.equal(parsed[0].isMainWorktree, true);
assert.equal(parsed[0].branch, "refs/heads/main");
assert.equal(parsed[1].isMainWorktree, false);
assert.equal(worktreeBranchName(parsed[1]), "bugfix/x");
assert.equal(parsed[2].branch, "");
assert.equal(parsed[2].prunable, true);
assert.equal(worktreeBranchName(parsed[2]), null);

// line-delimited fallback + paths with spaces
const lineRaw = "worktree /my repo/main wt\nHEAD abc\nbranch refs/heads/main\n\nworktree /other\nHEAD def\n";
const parsedLines = parseWorktreeList(lineRaw);
assert.equal(parsedLines.length, 2);
assert.equal(parsedLines[0].path, "/my repo/main wt");

// empty output → empty list, not an error
assert.deepEqual(parseWorktreeList(""), []);
assert.deepEqual(parseWorktreeList("\0\0", { nulDelimited: true }), []);

// ── name hygiene ────────────────────────────────────────────────────────────
assert.equal(sanitizeWorktreeName("  Fix  Login Bug! "), "fix-login-bug");
assert.equal(sanitizeWorktreeName("café // order"), "cafe-order");
assert.equal(sanitizeWorktreeName("a..b"), "a.b");
assert.equal(sanitizeWorktreeName("..weird-"), "weird");
assert.equal(sanitizeWorktreeName("x".repeat(60)).length, 48);
assert.equal(sanitizeWorktreeName("Contract's flow"), "contracts-flow");

// ── dep-policy resolution (Phase 2) ─────────────────────────────────────────
const pol = (hubPath: string, overrides?: RepoDepOverrides) =>
  depPolicies.resolve({ hubPath, overrides });

// nothing recognizable → none
const policyEmpty = path.join(tmp, "policy", "empty");
fs.mkdirSync(policyEmpty, { recursive: true });
assert.equal(pol(policyEmpty).strategy, "none");
assert.equal(pol(policyEmpty).source, "no recognized manifest+lockfile");

// non-JS ecosystems default to none in v0 (genericity guardrail — no rows yet)
const policyGo = path.join(tmp, "policy", "go");
fs.mkdirSync(policyGo, { recursive: true });
fs.writeFileSync(path.join(policyGo, "go.mod"), "module x\n");
assert.equal(pol(policyGo).strategy, "none");

// npm repo: clone policy carrying the frozen-install fallback
const policyNpm = path.join(tmp, "policy", "npm");
fs.mkdirSync(policyNpm, { recursive: true });
fs.writeFileSync(path.join(policyNpm, "package.json"), "{}");
fs.writeFileSync(path.join(policyNpm, "package-lock.json"), "{}");
const npmPolicy = pol(policyNpm);
assert.equal(npmPolicy.strategy, "clone");
assert.equal(npmPolicy.lockfile, "package-lock.json");
assert.equal(npmPolicy.fallback?.strategy, "install");
assert.equal(npmPolicy.fallback?.command, "npm ci");

// overrides win over everything — odd repos are configuration, not code paths
assert.equal(pol(policyNpm, { skip_install: true }).source, "override:skip_install");
const cmdPolicy = pol(policyNpm, { install_command: " pnpm install --filter web " });
assert.equal(cmdPolicy.strategy, "command");
assert.equal(cmdPolicy.command, "pnpm install --filter web");

// pnpm row: lockfile matched (clone; frozen-install fallback) — no global
// virtual-store toggle anymore, pnpm behaves like every other manager here
const policyPnpm = path.join(tmp, "policy", "pnpm");
fs.mkdirSync(policyPnpm, { recursive: true });
fs.writeFileSync(path.join(policyPnpm, "package.json"), "{}");
fs.writeFileSync(path.join(policyPnpm, "pnpm-lock.yaml"), "{}");
assert.equal(pol(policyPnpm).source, "node:pnpm:clone");
assert.equal(pol(policyPnpm).strategy, "clone");
assert.equal(pol(policyPnpm).lockfile, "pnpm-lock.yaml");

// manifest without a lockfile → none (no reproducible frozen install in v0)
fs.rmSync(path.join(policyNpm, "package-lock.json"));
assert.equal(pol(policyNpm).source, "node:manifest-without-lockfile");

// sync globs: defaults vs per-repo override
assert.deepEqual(depPolicies.resolveSyncGlobs(), DEFAULT_SYNC_GLOBS);
assert.deepEqual(depPolicies.resolveSyncGlobs({ sync_paths: "docs/*.md, .env*" }), ["docs/*.md", ".env*"]);

// glob expansion: dot-inclusive, dir-aware, skips .git/node_modules
const globHub = path.join(tmp, "policy", "globs");
fs.mkdirSync(path.join(globHub, ".git"), { recursive: true });
fs.mkdirSync(path.join(globHub, "node_modules"), { recursive: true });
fs.mkdirSync(path.join(globHub, "config"), { recursive: true });
fs.writeFileSync(path.join(globHub, ".env.local"), "A=1");
fs.writeFileSync(path.join(globHub, ".myapp.rc"), "{}");
fs.writeFileSync(path.join(globHub, "app.rc"), "{}");
fs.writeFileSync(path.join(globHub, "config", "settings.ini"), "x");
fs.writeFileSync(path.join(globHub, ".git", "ignored"), "");
fs.writeFileSync(path.join(globHub, "node_modules", "ignored"), "");
assert.deepEqual(
  depPolicies.expandSyncPaths(globHub, [".env*", "*.rc", "config/*.ini"]).sort(),
  [".env.local", ".myapp.rc", "app.rc", "config/settings.ini"].sort()
);

// ── real git lifecycle ──────────────────────────────────────────────────────

async function main() {
fs.mkdirSync(hub, { recursive: true });
fs.mkdirSync(wsDir, { recursive: true });

git(["init", "-q", "-b", "main"], hub);
git(["config", "user.email", "test@devflow.local"], hub);
git(["config", "user.name", "DevFlow Test"], hub);
fs.writeFileSync(path.join(hub, "README.md"), "# test\n");
// Phase 2 fixtures: a Node repo the dep-policy table recognizes
fs.writeFileSync(path.join(hub, "package.json"), '{ "name": "test", "version": "0.0.0" }');
fs.writeFileSync(path.join(hub, "package-lock.json"), "{}");
git(["add", "."], hub);
git(["commit", "-q", "-m", "init"], hub);

// 1. create from base (no origin → base chain falls back to local main)
const created = await worktrees.createWorktree({
  repoPath: hub, dir: wtDir, branch: "bugfix/dev-123-a7f3c2", base: "main",
});
assert.equal(created.reused, false);
assert.equal(created.base, "main");
assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"], wtDir), "bugfix/dev-123-a7f3c2");
// worktree shares the hub's object database…
assert.ok(
  samePath(
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], wtDir),
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], hub)
  )
);
// …post-create side effects landed
assert.equal(git(["config", "--get", "branch.bugfix/dev-123-a7f3c2.base"], hub), "main");
assert.equal(git(["config", "--get", "push.autoSetupRemote"], hub), "true");

// 2. listing shows it; main worktree first
const listed = await worktrees.listWorktrees(hub);
assert.equal(listed.length, 2);
assert.equal(listed[0].isMainWorktree, true);
assert.ok(listed.some((w) => w.path === fs.realpathSync(wtDir) || w.path === wtDir));

// 3. concurrent listings coalesce into one scan (same array instance)
const [a, b] = await Promise.all([worktrees.listWorktrees(hub), worktrees.listWorktrees(hub)]);
assert.equal(a, b);

// 4. dirty detection + refusal without force, removal with force
fs.writeFileSync(path.join(wtDir, "new.txt"), "agent work");
const dirty = await worktrees.preflightRemoval({ repoPath: hub, wtPath: wtDir, home: os.homedir() });
assert.equal(dirty.ok, true);
assert.equal(dirty.dirty, true);
await assert.rejects(
  () => worktrees.removeWorktree({ repoPath: hub, wtPath: wtDir }),
  /uncommitted changes/
);
const forced = await worktrees.removeWorktree({ repoPath: hub, wtPath: wtDir, force: true });
assert.equal(forced.removed, true);
assert.equal(forced.dirGone, true);
assert.ok(!fs.existsSync(wtDir));

// 5. unmerged branch work product survives removal (merged-only default)
const c2 = await worktrees.createWorktree({ repoPath: hub, dir: wtDir, branch: "bugfix/dev-123-a7f3c2", base: "main" });
// branch already existed (crash-recovery path): fresh checkout of that branch,
// no new branch created, and the recorded base provenance from step 1 survives
assert.equal(c2.reused, false);
assert.equal(c2.base, null);
assert.equal(git(["config", "--get", "branch.bugfix/dev-123-a7f3c2.base"], hub), "main");
git(["commit", "-q", "-m", "agent commit", "--allow-empty"], wtDir);
const unmerged = await worktrees.removeWorktree({ repoPath: hub, wtPath: wtDir, force: true, deleteBranch: true });
assert.equal(unmerged.removed, true);
assert.equal(unmerged.branchDeleted, false);
assert.equal(unmerged.branchKeptReason, "unmerged");
assert.ok(git(["rev-parse", "--verify", "refs/heads/bugfix/dev-123-a7f3c2"], hub).length > 0);

// 6. a merged branch is deleted with the worktree
const merged = await worktrees.createWorktree({ repoPath: hub, dir: wtDir, branch: "merged-branch", base: "main" });
assert.equal(merged.reused, false);
const mergedRemoval = await worktrees.removeWorktree({ repoPath: hub, wtPath: wtDir, force: true, deleteBranch: true });
assert.equal(mergedRemoval.branchDeleted, true);
// the branch ref is gone
assert.equal(gitFails(["rev-parse", "--verify", "refs/heads/merged-branch"], hub), true);

// 7. branch switched on reuse (multi-branch flows share one worktree dir)
const multi1 = await worktrees.createWorktree({ repoPath: hub, dir: wtDir, branch: "feature/first-branch", base: "main" });
assert.equal(multi1.reused, false);
const multi = await worktrees.createWorktree({ repoPath: hub, dir: wtDir, branch: "feature/second-branch", base: "main" });
assert.equal(multi.reused, true, "registered worktree dir is reused, not recreated");
assert.equal(multi.headBranch, "feature/second-branch");
assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"], wtDir), "feature/second-branch");

// 8. dangerous-path preflight refusals
for (const bad of [hub, os.tmpdir(), path.dirname(hub)]) {
  const refusal = await worktrees.preflightRemoval({ repoPath: hub, wtPath: bad, home: os.homedir() });
  const registered = await worktrees.listWorktrees(hub).then((ws) => ws.some((w) => w.path === fs.realpathSync(bad)));
  if (!registered) {
    assert.equal(refusal.ok, false, `must refuse ${bad}`);
    assert.match(refusal.reason ?? "", /refusing|no longer registered/);
  }
}
await assert.rejects(
  async () => worktrees.removeWorktree({ repoPath: hub, wtPath: hub, force: true }),
  /refusing|registered/
);

// 9. orphaned dir (git dropped the registration, dir remains) → prune clears it
fs.rmSync(wtDir, { recursive: true, force: true });
await worktrees.pruneWorktrees(hub);
const afterPrune = await worktrees.listWorktrees(hub);
assert.equal(afterPrune.filter((w) => !w.isMainWorktree).length, 0);

// 10. worktree setup executor (Phase 2) ─────────────────────────────────────
// hub dep state + untracked config fixtures (the hub is the source of deps,
// config and caches; the worktree starts as a tracked-files-only checkout)
fs.mkdirSync(path.join(hub, "node_modules"), { recursive: true });
fs.writeFileSync(path.join(hub, "node_modules", "dep.txt"), "dep");
fs.writeFileSync(path.join(hub, ".env.local"), "HUB_ENV=1");
fs.writeFileSync(path.join(hub, ".myapp.rc"), "{}");
fs.mkdirSync(path.join(hub, ".turbo"), { recursive: true });
fs.writeFileSync(path.join(hub, ".turbo", "cache.txt"), "warm");
fs.mkdirSync(path.join(hub, "docs"), { recursive: true });
fs.writeFileSync(path.join(hub, "docs", "guide.md"), "guide");

const setupEvents: string[] = [];
// clone on lockfile match: node_modules copied, config + caches synced
const hubPolicy = pol(hub); // package.json + package-lock.json → npm clone row
assert.equal(hubPolicy.strategy, "clone");
const createdSetup = await worktrees.createWorktree({ repoPath: hub, dir: wtDir, branch: "setup-branch-1", base: "main" });
assert.equal(createdSetup.reused, false);
const setup1 = await worktreeSetup.run({
  hubPath: hub, worktreePath: wtDir, policy: hubPolicy,
  syncGlobs: depPolicies.resolveSyncGlobs(),
  onEvent: (m) => setupEvents.push(m),
});
assert.equal(setup1.ok, true);
assert.ok(setup1.actions?.join("\n").includes("copied node_modules from the hub"));
assert.ok(setupEvents.includes("copying node_modules from the hub"));
assert.ok(fs.existsSync(path.join(wtDir, "node_modules", "dep.txt")));
assert.equal(fs.readFileSync(path.join(wtDir, ".env.local"), "utf8"), "HUB_ENV=1");
assert.ok(fs.existsSync(path.join(wtDir, ".myapp.rc")), "*.rc globs are dot-inclusive");
assert.ok(fs.existsSync(path.join(wtDir, ".turbo", "cache.txt")), "warm caches copied when present");
// the copy preserves relative workspace links semantics: dest files are real content
assert.equal(fs.lstatSync(path.join(wtDir, "node_modules", "dep.txt")).isSymbolicLink(), false);

// hub/worktree lockfile mismatch → the frozen-install fallback, no stale copy
fs.writeFileSync(path.join(hub, "package-lock.json"), '{"changed":true}');
const wtDir2 = path.join(wsDir, "flow_setup2");
await worktrees.createWorktree({ repoPath: hub, dir: wtDir2, branch: "setup-branch-2", base: "main" });
const fallbackPolicy: DepPolicy = {
  strategy: "clone", depDirs: ["node_modules"], lockfile: "package-lock.json",
  fallback: { strategy: "install", command: "echo fallback-ran > .fallback-marker", source: "test" },
  source: "test",
};
const setup2 = await worktreeSetup.run({ hubPath: hub, worktreePath: wtDir2, policy: fallbackPolicy });
assert.equal(setup2.ok, true);
assert.ok(fs.existsSync(path.join(wtDir2, ".fallback-marker")));
assert.ok(!fs.existsSync(path.join(wtDir2, "node_modules")), "mismatch → no stale dep copy");
// restore the hub lockfile (working tree matches HEAD again)
fs.writeFileSync(path.join(hub, "package-lock.json"), "{}");

// command strategy + shared_dirs symlinks + setup_command override
const wtDir3 = path.join(wsDir, "flow_setup3");
await worktrees.createWorktree({ repoPath: hub, dir: wtDir3, branch: "setup-branch-3", base: "main" });
fs.mkdirSync(path.join(hub, ".shared"), { recursive: true });
fs.writeFileSync(path.join(hub, ".shared", "cfg.txt"), "cfg");
const setup3 = await worktreeSetup.run({
  hubPath: hub, worktreePath: wtDir3,
  policy: { strategy: "command", command: "echo cmd-ran > cmd.txt", source: "test" },
  sharedDirs: [".shared"],
  setupCommand: "echo done > .setup-done",
});
assert.equal(setup3.ok, true);
assert.ok(fs.existsSync(path.join(wtDir3, "cmd.txt")), "command strategy runs in the worktree");
assert.ok(fs.existsSync(path.join(wtDir3, ".setup-done")), "setup_command runs after the strategy");
assert.ok(fs.lstatSync(path.join(wtDir3, ".shared")).isSymbolicLink(), "shared dirs are symlinked");
assert.equal(fs.readFileSync(path.join(wtDir3, ".shared", "cfg.txt"), "utf8"), "cfg");

// failing commands are RESULTS (never thrown) — non-fatal agent self-repair
const setup4 = await worktreeSetup.run({
  hubPath: hub, worktreePath: wtDir3,
  policy: { strategy: "command", command: "exit 3", source: "test" },
  setupCommand: "echo should-not-run > .nope",
});
assert.equal(setup4.ok, false);
assert.match(setup4.error ?? "", /exit 3/);
assert.ok(!fs.existsSync(path.join(wtDir3, ".nope")), "steps stop at the first failure");

// a declared shared dir missing from the hub is a config error (non-fatal)
const setup5 = await worktreeSetup.run({
  hubPath: hub, worktreePath: wtDir3,
  policy: { strategy: "none", source: "test" },
  sharedDirs: ["missing-dir"],
});
assert.equal(setup5.ok, false);
assert.match(setup5.error ?? "", /shared dir missing-dir/);

// dep trees are never symlinked (resolution must not reach into the hub)
const setup6 = await worktreeSetup.run({
  hubPath: hub, worktreePath: wtDir3,
  policy: { strategy: "none", source: "test" },
  sharedDirs: ["node_modules"],
});
assert.equal(setup6.ok, false);
assert.match(setup6.error ?? "", /never/);

console.log("\npure worktree layer checks passed ✓");
}

// ── engine adapter lifecycle (isolated temp db + workspace) ─────────────────
async function lifecycleSmoke() {
  process.env.DATABASE_PATH = path.join(tmp, "devflow.db");
  process.env.WORKSPACE_DIR = wsDir;

  const { db } = await import("../lib/db");
  const { worktreeManager } = await import("../lib/engine/runtime/worktree-lifecycle");
  const { FlowRow, Task, rows } = await import("../lib/db/rows");

  // seed repo / task / flow rows (local mode, worktree-capable)
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO repos (id, name, cloud_url, local_path, default_branch, created_at, updated_at)
     VALUES ('repo_1', 'Test Repo', 'https://git.example.com/g/test', ?, 'main', ?, ?)`, hub, now, now);
  db.run(
    `INSERT INTO tasks (id, type, fields, key, summary, status, priority, repo_url, synced_at)
     VALUES ('t1', 'jira', '{}', 'DEV-1', 'Test task', 'open', 'P2', 'https://git.example.com/g/test', ?)`, now);
  db.run(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, repo_id, created_at, updated_at)
     VALUES ('flow_smoke', 't1', 'Smoke', 'active', 'local', 'repo_1', ?, ?)`, now, now);

  const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_smoke")!;
  const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, "t1")!;
  const repo = db.repoById("repo_1");
  const ctx = { flow, task, repo };

  const binding = await worktreeManager.ensureFlowWorktree(ctx, "bugfix/dev-1-smoke", { nodeId: "node_x" });
  const wt = binding.dir;
  assert.equal(wt, fs.realpathSync(path.join(wsDir, "flow_smoke")), "canonical (realpath) dir stored/returned");
  assert.ok(fs.existsSync(path.join(wt!, ".git")));
  assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"], wt!), "bugfix/dev-1-smoke");
  // persisted on the flow row + ctx object
  assert.equal((rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_smoke")!).worktree_dir, wt);
  assert.equal(ctx.flow.worktree_dir, wt);
  // lifecycle event emitted
  assert.ok(db.all<any>(`SELECT * FROM events WHERE flow_id='flow_smoke' AND type='lifecycle'`).some((e: any) => /worktree/.test(e.message)));

  // ── Phase 2: the fresh worktree ran the repo's dep policy (npm clone row:
  //    hub node_modules + matching lockfile → node_modules copied) + config sync
  assert.equal(binding.setupNote, null);
  assert.ok(fs.existsSync(path.join(wt!, "node_modules", "dep.txt")), "dep tree cloned from the hub");
  assert.ok(fs.existsSync(path.join(wt!, ".env.local")), "untracked config synced (default globs)");
  assert.ok(
    db.all<any>(`SELECT * FROM events WHERE flow_id='flow_smoke' AND type='lifecycle'`)
      .some((e: any) => /setting up worktree deps/.test(e.message)),
    "setup emits a lifecycle event like any other step"
  );

  // a failing policy is NON-FATAL: the worktree is kept and the agent's run
  // prompt gets one line ("worktree deps setup failed: <err>")
  db.run(`UPDATE repos SET install_command='exit 3' WHERE id='repo_1'`);
  ctx.repo = db.repoById("repo_1")!; // re-fetch: the ctx caches the repo row
  await worktreeManager.removeFlowWorktree("flow_smoke", { reason: "recreate for the setup-failure test" });
  ctx.flow.worktree_dir = null;
  const failing = await worktreeManager.ensureFlowWorktree(ctx, "bugfix/dev-1-smoke3", { nodeId: "node_x" });
  assert.ok(failing.dir, "worktree kept despite deps-setup failure");
  assert.match(failing.setupNote ?? "", /worktree deps setup failed/);
  db.run(`UPDATE repos SET install_command=NULL WHERE id='repo_1'`);
  ctx.repo = db.repoById("repo_1")!;

  // reuse skips setup (deps setup is per flow, not per run)
  const reused = await worktreeManager.ensureFlowWorktree(ctx, "bugfix/dev-1-smoke3", { nodeId: "node_x" });
  assert.equal(reused.dir, failing.dir);
  assert.equal(reused.setupNote, null);

  // terminal flow → sweep removes the worktree and clears the column
  db.run(`UPDATE flows SET status='done' WHERE id='flow_smoke'`);
  await worktreeManager.sweepWorktrees();
  assert.ok(!fs.existsSync(wt!), "terminal flow's worktree removed by sweep");
  assert.equal((rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_smoke")!).worktree_dir, null);

  // flow deletion case: a worktree dir whose flow row is gone
  const flow2 = { ...ctx.flow, id: "flow_gone", status: "active", worktree_dir: null };
  db.run(`INSERT INTO flows (id, task_id, name, status, execution_mode, repo_id, created_at, updated_at)
          VALUES ('flow_gone', 't1', 'Gone', 'active', 'local', 'repo_1', ?, ?)`, now, now);
  const wt2 = (await worktreeManager.ensureFlowWorktree({ ...ctx, flow: flow2 as typeof ctx.flow }, "bugfix/gone-1")).dir;
  assert.equal(wt2, fs.realpathSync(path.join(wsDir, "flow_gone")));
  // simulate flow deletion (events cleaned with it, as a real delete would)
  db.run(`DELETE FROM events WHERE flow_id='flow_gone'`);
  db.run(`DELETE FROM flows WHERE id='flow_gone'`);
  await worktreeManager.sweepWorktrees();
  assert.ok(!fs.existsSync(wt2!), "worktree of a deleted flow removed by sweep");
  assert.equal(db.all<any>(`SELECT * FROM worktree_removals`).length, 0, "no stale removal records");

  // explicit removal helper (future terminal-state hooks)
  ctx.flow.worktree_dir = null; // resync the in-memory ctx with the DB (sweep cleared it)
  const wt3 = (await worktreeManager.ensureFlowWorktree(ctx, "bugfix/dev-1-smoke2")).dir;
  assert.ok(wt3);
  assert.equal((rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_smoke")!).worktree_dir, wt3);
  await worktreeManager.removeFlowWorktree("flow_smoke", { reason: "test removal" });
  assert.ok(!fs.existsSync(wt3!));
  assert.equal((rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_smoke")!).worktree_dir, null);

  // ── Phase 3: the flow-card worktree-status endpoint (list + branchState) ──
  const { GET: wtStatusGET } = await import("../app/api/flows/worktree-status/route");
  db.run(`INSERT INTO flows (id, task_id, name, status, execution_mode, repo_id, created_at, updated_at)
          VALUES ('flow_status', 't1', 'Status', 'active', 'local', 'repo_1', ?, ?)`, now, now);
  const statusCtx = { ...ctx, flow: rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_status")! };
  const wt4 = (await worktreeManager.ensureFlowWorktree(statusCtx, "bugfix/status-1")).dir;
  assert.ok(wt4);
  // a commit (ahead=1) + an untracked file (dirty)
  fs.writeFileSync(path.join(wt4!, "change.txt"), "hello");
  git(["add", "change.txt"], wt4!);
  git(["commit", "-m", "wip"], wt4!);
  fs.writeFileSync(path.join(wt4!, "scratch.tmp"), "untracked");
  const { statuses } = await (await wtStatusGET()).json();
  const st = statuses.flow_status;
  assert.equal(st.registered, true, "worktree registered in git");
  assert.equal(st.branch, "bugfix/status-1");
  assert.equal(st.dirty, true, "untracked file counts as dirty");
  assert.equal(st.ahead, 1);
  assert.equal(st.pushed, false);
  assert.ok(st.path.endsWith("flow_status"));
  // a flow with a worktree_dir pointing nowhere reports unregistered, not a crash
  db.run(`UPDATE flows SET worktree_dir=? WHERE id='flow_status'`, path.join(wsDir, "flow_nope"));
  const stale = (await (await wtStatusGET()).json()).statuses.flow_status;
  assert.equal(stale.registered, false, "unregistered worktree reports registered=false");
  assert.match(stale.reason ?? "", /not a registered worktree/);
  // NOTE: the db connection stays open — runnerEnsureSmoke (next section) uses it
}

// ── engine runner-ensure smoke (Option B, isolated flows in the same db/hub) ──
// The runner-facing ensure: pins win, plan runs get no worktree, unpinned
// mutating runs ensure the tree (current head branch, never an implicit
// switch), disabled/cloud flows get the hub fallback, concurrent ensures
// coalesce. Reuses lifecycleSmoke's db, git fixture and seeding style.
async function runnerEnsureSmoke() {
  process.env.DATABASE_PATH = path.join(tmp, "devflow.db");
  process.env.WORKSPACE_DIR = wsDir;

  const { db } = await import("../lib/db");
  const { worktreeManager } = await import("../lib/engine/runtime/worktree-lifecycle");
  const { FlowRow, Task, rows } = await import("../lib/db/rows");
  const { flowCtxHelper } = await import("../lib/engine/nodes/base/flow-context");

  // the task + repo rows are seeded by lifecycleSmoke ("t1" on "repo_1")
  const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, "t1")!;
  const repo = () => db.repoById("repo_1")!;

  const seedFlow = (id: string, opts: { executionMode?: string; mrBranch?: string } = {}) => {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO flows (id, task_id, name, status, execution_mode, repo_id, mr_branch, created_at, updated_at)
       VALUES (?, 't1', ?, 'active', ?, 'repo_1', ?, ?, ?)`,
      id, id, opts.executionMode ?? "local", opts.mrBranch ?? null, now, now);
    return rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, id)!;
  };

  const lifecycle = (flowId: string) =>
    db.all<any>(`SELECT * FROM events WHERE flow_id=? AND type='lifecycle' ORDER BY id`, flowId);
  const totalEvents = (flowId: string) =>
    db.all<any>(`SELECT * FROM events WHERE flow_id=?`, flowId);
  const countMatching = (events: any[], re: RegExp) => events.filter((e: any) => re.test(e.message)).length;

  // ── #1: standalone flow, unpinned mutating run → ensured into the worktree ──
  {
    const flow = seedFlow("flow_run1");
    const ctx = { flow, task, repo: repo() };
    const expectedBranch = flowCtxHelper.buildBranch(ctx);
    assert.match(
      expectedBranch, /^bugfix\/dev-1-\w{6}$/,
      "non-story task fallback uses the build naming convention (bugfix/<task-key>-<flowid6>)"
    );
    const r1 = await worktreeManager.ensureForRun(ctx, {
      mode: "agent", nodeId: "node_ensure1", defaultBranch: expectedBranch,
    });
    assert.ok(r1.cwd, "unpinned agent run got a worktree cwd");
    assert.equal(r1.cwd, fs.realpathSync(path.join(wsDir, "flow_run1")), "canonical workspaces/<flowId> dir returned");
    assert.ok(fs.existsSync(path.join(r1.cwd!, ".git")), "worktree on disk at the canonical path");
    assert.equal(r1.setupNote, null, "healthy deps setup → no advisory note");
    assert.equal(
      git(["rev-parse", "--abbrev-ref", "HEAD"], r1.cwd!), expectedBranch,
      "fresh tree's head branch = the caller's defaultBranch (buildBranch shape)"
    );
    assert.ok(fs.existsSync(path.join(r1.cwd!, "node_modules", "dep.txt")), "deps policy ran once on ensure");
    assert.equal(
      (rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_run1")!).worktree_dir, r1.cwd,
      "binding persisted to flows.worktree_dir"
    );
    const events1 = lifecycle("flow_run1");
    assert.ok(countMatching(events1, /worktree created at/) === 1, "creation lifecycle event emitted");
    assert.ok(countMatching(events1, /setting up worktree deps/) === 1, "deps-setup lifecycle event emitted");

    // ── #2: identical call again → same dir, no re-setup, no duplicate creation ──
    const created1 = countMatching(events1, /worktree created at/);
    const setup1 = countMatching(events1, /setting up worktree deps/);
    const r2 = await worktreeManager.ensureForRun(ctx, {
      mode: "agent", nodeId: "node_ensure1", defaultBranch: expectedBranch,
    });
    assert.equal(r2.cwd, r1.cwd, "reuse returns the same dir");
    assert.equal(r2.setupNote, null);
    const events2 = lifecycle("flow_run1");
    assert.equal(countMatching(events2, /worktree created at/), created1, "creation event not duplicated");
    assert.equal(countMatching(events2, /setting up worktree deps/), setup1, "deps setup NOT re-run on reuse");
  }

  // ── #3: plan run (read-only) → no worktree, hub stays clean ─────────────────
  {
    const flow = seedFlow("flow_run3");
    const ctx = { flow, task, repo: repo() };
    const r3 = await worktreeManager.ensureForRun(ctx, {
      mode: "plan", defaultBranch: flowCtxHelper.buildBranch(ctx),
    });
    assert.equal(r3.cwd, undefined, "plan run gets no worktree cwd");
    assert.equal(r3.setupNote, null);
    assert.ok(!fs.existsSync(path.join(wsDir, "flow_run3")), "no worktree created on disk");
    assert.equal(totalEvents("flow_run3").length, 0, "no lifecycle events from a plan run");
    assert.equal(
      (rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_run3")!).worktree_dir, null,
      "flows.worktree_dir untouched"
    );
  }

  // ── #4: explicit cwd pin wins, manager fully uninvolved ──────────────────────
  {
    const flow = seedFlow("flow_run4");
    const ctx = { flow, task, repo: repo() };
    const r4 = await worktreeManager.ensureForRun(ctx, {
      mode: "agent", cwd: "/explicit/pin", defaultBranch: flowCtxHelper.buildBranch(ctx),
    });
    assert.equal(r4.cwd, "/explicit/pin", "pinned cwd returned verbatim");
    assert.equal(r4.setupNote, null);
    assert.ok(!fs.existsSync(path.join(wsDir, "flow_run4")), "no ensure side effects — no worktree dir");
    assert.equal(totalEvents("flow_run4").length, 0, "no ensure side effects — no events");
    assert.equal(
      (rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_run4")!).worktree_dir, null,
      "no ensure side effects — flows.worktree_dir untouched"
    );
  }

  // ── #5: existing tree on branch X stays on X even with mr_branch=Y ──────────
  {
    const flow = seedFlow("flow_stay");
    const ctx = { flow, task, repo: repo() };
    // seed the tree so its CURRENT head branch is X (the ensure's fallback naming)
    const existingBranch = "bugfix/dev-1-stayx";
    const first = await worktreeManager.ensureForRun(ctx, {
      mode: "agent", defaultBranch: existingBranch,
    });
    assert.ok(first.cwd, "tree created for the stay-on-branch fixture");
    assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"], first.cwd!), existingBranch, "tree head is X");
    // simulate a later build/MR step having set the canonical mr_branch=Y
    db.run(`UPDATE flows SET mr_branch=? WHERE id='flow_stay'`, "bugfix/dev-1-stayy");
    const ctxStay = {
      flow: rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_stay")!,
      task, repo: repo(),
    };
    const second = await worktreeManager.ensureForRun(ctxStay, {
      mode: "agent", nodeId: "node_ensure5", defaultBranch: "bugfix/dev-1-stayy",
    });
    assert.equal(second.cwd, first.cwd, "existing tree dir reused");
    assert.equal(
      git(["rev-parse", "--abbrev-ref", "HEAD"], second.cwd!), existingBranch,
      "worktree STAYS on its current branch X — mr_branch/defaultBranch Y must not force an implicit switch"
    );
  }

  // ── #7: cloud execution mode → no worktree, nothing created ─────────────────
  {
    const flow = seedFlow("flow_cloud", { executionMode: "cloud" });
    const ctx = { flow, task, repo: repo() };
    const r7 = await worktreeManager.ensureForRun(ctx, {
      mode: "agent", defaultBranch: flowCtxHelper.buildBranch(ctx),
    });
    assert.equal(r7.cwd, undefined, "cloud flow → no worktree cwd");
    assert.equal(r7.setupNote, null);
    assert.ok(!fs.existsSync(path.join(wsDir, "flow_cloud")), "nothing created for a cloud flow");
    assert.equal(totalEvents("flow_cloud").length, 0, "no events for a cloud flow");
    assert.equal(
      (rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_cloud")!).worktree_dir, null,
      "flows.worktree_dir untouched"
    );
  }

  // ── #8: two concurrent ensures for the same flow+branch coalesce ────────────
  {
    const flow = seedFlow("flow_cons");
    const ctx = { flow, task, repo: repo() };
    const defaultBranch = flowCtxHelper.buildBranch(ctx);
    const [c1, c2] = await Promise.all([
      worktreeManager.ensureForRun(ctx, { mode: "agent", nodeId: "node_a", defaultBranch }),
      worktreeManager.ensureForRun(ctx, { mode: "agent", nodeId: "node_b", defaultBranch }),
    ]);
    assert.ok(c1.cwd && c2.cwd, "both concurrent ensures resolved");
    assert.equal(c1.cwd, c2.cwd, "both calls resolve to the same dir");
    assert.equal(
      lifecycle("flow_cons").filter((e: any) => /worktree created at/.test(e.message)).length, 1,
      "coalescing worked — exactly ONE worktree created event"
    );
    assert.equal(
      lifecycle("flow_cons").filter((e: any) => /setting up worktree deps/.test(e.message)).length, 1,
      "deps setup ran once despite the concurrency"
    );
    assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"], c1.cwd!), defaultBranch, "coalesced tree on the default branch");
  }

  db.connection().close(); // last db-using section
}

async function all() {
  await main();
  await lifecycleSmoke();
  await runnerEnsureSmoke();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("\nall worktree checks passed ✓");
}

all().catch((e) => {
  console.error(e);
  process.exit(1);
});
