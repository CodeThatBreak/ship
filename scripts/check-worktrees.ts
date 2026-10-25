/**
 * Sanity checks for Phase 1 worktree support: the porcelain parser, name
 * hygiene, path helpers, and the real-git create/remove lifecycle (preflight,
 * merged-only branch cleanup, crash-recovery reuse).
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
const src = fs.readFileSync(new URL("../lib/git/worktrees.ts", import.meta.url), "utf8");
assert.ok(!/from\s+["'].*(\.\.\/db|\.\.\/engine|@\/)/.test(src), "worktrees.ts must not import db/engine layers");

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

// ── real git lifecycle ──────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-wt-"));
const hub = path.join(tmp, "hub");
const wsDir = path.join(tmp, "workspaces");
const wtDir = path.join(wsDir, "flow_1");

async function main() {
fs.mkdirSync(hub, { recursive: true });
fs.mkdirSync(wsDir, { recursive: true });

git(["init", "-q", "-b", "main"], hub);
git(["config", "user.email", "test@devflow.local"], hub);
git(["config", "user.name", "DevFlow Test"], hub);
fs.writeFileSync(path.join(hub, "README.md"), "# test\n");
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

console.log("\npure worktree layer checks passed ✓");
}

// ── engine adapter lifecycle (isolated temp db + workspace) ─────────────────
async function lifecycleSmoke() {
  process.env.DATABASE_PATH = path.join(tmp, "devflow.db");
  process.env.WORKSPACE_DIR = wsDir;

  const { db } = await import("../lib/db");
  const { worktreeManager } = await import("../lib/engine/worktree-lifecycle");
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

  const wt = await worktreeManager.ensureFlowWorktree(ctx, "bugfix/dev-1-smoke", { nodeId: "node_x" });
  assert.equal(wt, fs.realpathSync(path.join(wsDir, "flow_smoke")), "canonical (realpath) dir stored/returned");
  assert.ok(fs.existsSync(path.join(wt!, ".git")));
  assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"], wt!), "bugfix/dev-1-smoke");
  // persisted on the flow row + ctx object
  assert.equal((rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_smoke")!).worktree_dir, wt);
  assert.equal(ctx.flow.worktree_dir, wt);
  // lifecycle event emitted
  assert.ok(db.all<any>(`SELECT * FROM events WHERE flow_id='flow_smoke' AND type='lifecycle'`).some((e: any) => /worktree/.test(e.message)));

  // terminal flow → sweep removes the worktree and clears the column
  db.run(`UPDATE flows SET status='done' WHERE id='flow_smoke'`);
  await worktreeManager.sweepWorktrees();
  assert.ok(!fs.existsSync(wt!), "terminal flow's worktree removed by sweep");
  assert.equal((rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_smoke")!).worktree_dir, null);

  // flow deletion case: a worktree dir whose flow row is gone
  const flow2 = { ...ctx.flow, id: "flow_gone", status: "active", worktree_dir: null };
  db.run(`INSERT INTO flows (id, task_id, name, status, execution_mode, repo_id, created_at, updated_at)
          VALUES ('flow_gone', 't1', 'Gone', 'active', 'local', 'repo_1', ?, ?)`, now, now);
  const wt2 = await worktreeManager.ensureFlowWorktree({ ...ctx, flow: flow2 as typeof ctx.flow }, "bugfix/gone-1");
  assert.equal(wt2, fs.realpathSync(path.join(wsDir, "flow_gone")));
  // simulate flow deletion (events cleaned with it, as a real delete would)
  db.run(`DELETE FROM events WHERE flow_id='flow_gone'`);
  db.run(`DELETE FROM flows WHERE id='flow_gone'`);
  await worktreeManager.sweepWorktrees();
  assert.ok(!fs.existsSync(wt2!), "worktree of a deleted flow removed by sweep");
  assert.equal(db.all<any>(`SELECT * FROM worktree_removals`).length, 0, "no stale removal records");

  // explicit removal helper (future terminal-state hooks)
  ctx.flow.worktree_dir = null; // resync the in-memory ctx with the DB (sweep cleared it)
  const wt3 = await worktreeManager.ensureFlowWorktree(ctx, "bugfix/dev-1-smoke2");
  assert.ok(wt3);
  assert.equal((rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_smoke")!).worktree_dir, wt3);
  await worktreeManager.removeFlowWorktree("flow_smoke", { reason: "test removal" });
  assert.ok(!fs.existsSync(wt3!));
  assert.equal((rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, "flow_smoke")!).worktree_dir, null);

  db.connection().close();
}

async function all() {
  await main();
  await lifecycleSmoke();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("\nall worktree checks passed ✓");
}

all().catch((e) => {
  console.error(e);
  process.exit(1);
});
