import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// never let a git command hang the engine (a big first checkout can take a while)
const GIT_TIMEOUT_MS = 20_000;
const GIT_WORKTREE_ADD_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 1024 * 1024 * 10;

/**
 * Git worktree info as git reports it from `git worktree list --porcelain`.
 */
export interface GitWorktreeInfo {
  /** absolute path git reports for the worktree (main worktree first) */
  path: string;
  /** HEAD oid ("" when unknown) */
  head: string;
  /** checked-out ref, e.g. "refs/heads/main"; "" when detached / bare */
  branch: string;
  isBare: boolean;
  isMainWorktree: boolean;
  locked: boolean;
  /** git ≥2.36: registration exists but the directory is gone */
  prunable: boolean;
}

/** "refs/heads/bugfix/x" → "bugfix/x"; ""/detached → null. */
export function worktreeBranchName(wt: Pick<GitWorktreeInfo, "branch">): string | null {
  return wt.branch.startsWith("refs/heads/") ? wt.branch.slice("refs/heads/".length) : null;
}

/** Path equality, tolerant of spelling/symlink differences and trailing slashes. */
export function samePath(a: string, b: string): boolean {
  const canon = (p: string): string => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  return canon(a) === canon(b);
}

/** True when `inner` equals `outer` or lives inside it. */
export function containsPath(outer: string, inner: string): boolean {
  const rel = path.relative(path.resolve(outer), path.resolve(inner));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Removal-target guard (Orca's rules): never remove an empty path, the repo
 * itself, the filesystem root, a path that CONTAINS the repo (the repo would
 * be nested inside the removal target), or the user's home.
 */
export function isDangerousWorktreeRemovalPath(
  wtPath: string,
  repoPath: string,
  home?: string
): boolean {
  if (!wtPath.trim()) return true;
  if (samePath(wtPath, repoPath)) return true;
  const resolved = path.resolve(wtPath);
  if (resolved === path.parse(resolved).root) return true;
  if (containsPath(wtPath, repoPath)) return true; // repo nested inside the worktree
  if (home && (samePath(wtPath, home) || containsPath(wtPath, home))) return true;
  return false;
}

/**
 * Sanitize a free-text name into a path/ref-safe slug (Orca's rules):
 * unicode-folded, lowercase, separators → hyphen, no `..` (git ref-format
 * rejects it), no leading/trailing separators, capped at 48 chars.
 */
export function sanitizeWorktreeName(input: string): string {
  return input
    .replace(/[\u2018\u2019]/g, "'")
    // contractions and possessives must not become stray "t"/"s" tokens
    .replace(/([\p{L}\p{N}])'(?=[\p{L}\p{N}])/gu, "$1")
    .replace(/(^|[^\p{L}\p{N}])'(?=[\p{L}\p{N}])/gu, "$1")
    .replace(/([\p{L}\p{N}])'(?=$|[^\p{L}\p{N}])/gu, "$1")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // fold accented letters to ASCII
    .trim()
    .toLowerCase()
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 48)
    .replace(/[-._]+$/g, "");
}

/**
 * Parse the output of `git worktree list --porcelain` (NUL-delimited when
 * `nulDelimited`, the format the `-z` flag produces — paths can contain \n).
 */
export function parseWorktreeList(
  output: string,
  options: { nulDelimited?: boolean } = {}
): GitWorktreeInfo[] {
  const blocks = options.nulDelimited
    ? splitNul(output)
    : output.trim().split(/\r?\n\r?\n/).map((b) => b.trim().split(/\r?\n/));

  const worktrees: GitWorktreeInfo[] = [];
  for (const lines of blocks) {
    if (lines.length === 0) continue;
    let wt: GitWorktreeInfo | null = null;
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        // `git worktree list` always emits the main working tree first
        wt = {
          path: line.slice("worktree ".length),
          head: "",
          branch: "",
          isBare: false,
          isMainWorktree: worktrees.length === 0,
          locked: false,
          prunable: false,
        };
      } else if (!wt) {
        continue; // field before any "worktree" header — ignore
      } else if (line.startsWith("HEAD ")) {
        wt.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        wt.branch = line.slice("branch ".length);
      } else if (line === "bare") {
        wt.isBare = true;
      } else if (line === "locked" || line.startsWith("locked ")) {
        wt.locked = true;
      } else if (line === "prunable" || line.startsWith("prunable ")) {
        wt.prunable = true;
      }
    }
    if (wt?.path) worktrees.push(wt);
  }
  return worktrees;
}

function splitNul(output: string): string[][] {
  if (!output.includes("\0")) {
    // older git or a defensive fallback: line-delimited records
    return output
      .trim()
      .split(/\r?\n\r?\n/)
      .map((b) => b.trim().split(/\r?\n/));
  }
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const field of output.split("\0")) {
    if (field) {
      current.push(field);
    } else if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

// ── input/result types ──────────────────────────────────────────────────────

export interface CreateWorktreeInput {
  /** the hub: the repo whose object database the worktree shares */
  repoPath: string;
  /** absolute dir for the new worktree (must live OUTSIDE the repo tree) */
  dir: string;
  branch: string;
  /** default branch name (or ref) to base on; resolved through a fallback chain */
  base?: string;
}

export interface WorktreeCreateResult {
  dir: string;
  branch: string;
  /** branch actually checked out after create/switch */
  headBranch: string;
  /** the base ref the branch was created from (null when reused) */
  base: string | null;
  /** true when the dir already held a registered worktree (reused, not created) */
  reused: boolean;
}

export interface PreflightResult {
  /** false = refuse removal; `reason` says why */
  ok: boolean;
  reason?: string;
  /** the worktree has modified/untracked files (callers decide whether to force) */
  dirty: boolean;
  /** the registered worktree row (the checked-out branch is gone from git's listing after removal) */
  worktree?: GitWorktreeInfo;
}

export interface RemoveWorktreeInput {
  repoPath: string;
  wtPath: string;
  home?: string;
  /** remove even when the worktree is dirty (terminal-state cleanup) */
  force?: boolean;
  /** attempt a branch delete after removal (merged-only unless forceBranchDelete) */
  deleteBranch?: boolean;
  forceBranchDelete?: boolean;
}

export interface WorktreeRemovalResult {
  removed: boolean;
  /** git's registration + directory are both gone */
  dirGone: boolean;
  dirty?: boolean;
  /** outcome of the (optional) branch cleanup */
  branchDeleted?: boolean;
  branchKeptReason?: "unmerged" | "checked-out" | "missing";
}

/**
 * Git worktree mechanics — a PURE layer: plain inputs (repo path, branch, dir),
 * plain results. No db / engine / framework imports here; the engine-side
 * manager (lib/engine/worktree-lifecycle.ts) owns the flow ↔ worktree binding.
 *
 * Patterns ported from Orca's production worktree implementation:
 *  - listing via `--porcelain -z`, parsed once, coalesced per repo, STRICT
 *    (a failed listing must never surface as an authoritative empty list —
 *    callers would prune live worktrees with it)
 *  - every create is verified with a strict re-list, with a direct probe of
 *    the created path as fallback (a successful `worktree add` exit code is
 *    not proof — timing, maintenance locks)
 *  - removal preflight is an ordered gate: registered? → dangerous-path
 *    refusal → nested-worktree refusal → dirty report; branch cleanup is
 *    separate and merged-only by default
 */
export class Worktrees {
  /** One in-flight scan per repo — concurrent callers share the same git exec. */
  private readonly inflight = new Map<string, Promise<GitWorktreeInfo[]>>();

  /**
   * List a repo's worktrees. STRICT: throws on git failure — a failed scan must
   * never be published as an empty list (it would make sweepers prune live
   * worktrees). Callers decide how to soften.
   */
  async listWorktrees(repoPath: string): Promise<GitWorktreeInfo[]> {
    const key = path.resolve(repoPath);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const scan = (async () => {
      const { stdout } = await this.git(
        ["-C", repoPath, "worktree", "list", "--porcelain", "-z"],
        { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER }
      );
      return parseWorktreeList(stdout, { nulDelimited: true });
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, scan);
    return scan;
  }

  /** Drop stale worktree registrations (directories deleted behind git's back). */
  async pruneWorktrees(repoPath: string): Promise<void> {
    await this.git(["-C", repoPath, "worktree", "prune"], { timeout: GIT_TIMEOUT_MS });
  }

  /**
   * Create (or reuse) a git worktree at `dir` with `branch` checked out.
   *
   * Base resolution: `origin/<base>` → `<base>` → `origin/master` → `master`
   * (the same chain localBranchState uses) — the worktree bases off the freshest
   * available snapshot of the repo's default branch.
   *
   * Side effects (best-effort, warn-only, per Orca): `branch.<branch>.base`
   * provenance config + `push.autoSetupRemote=true` so the first plain push
   * from a fresh worktree branch just works.
   */
  async createWorktree(input: CreateWorktreeInput): Promise<WorktreeCreateResult> {
    const { repoPath, dir, branch } = input;
    const worktrees = await this.listWorktrees(repoPath);
    const existing = worktrees.find((w) => !w.isMainWorktree && samePath(w.path, dir));

    if (existing) {
      const headBranch = await this.switchWorktreeBranch(dir, branch, input.base);
      return { dir, branch, headBranch: headBranch ?? branch, base: null, reused: true };
    }

    // the dir must not exist for `worktree add` — clear orphaned leftovers
    this.prepareDir(dir, worktrees);

    let base: string | null = null;
    if (await this.refExists(repoPath, `refs/heads/${branch}`)) {
      // branch already exists (e.g. a crashed run left it with commits) — check it out
      await this.gitWorktreeAdd(repoPath, [dir, branch]);
    } else {
      base = await this.resolveBaseRef(repoPath, input.base);
      // --no-track: don't inherit the base's upstream (status would misreport
      // "behind by N" pre-push; the first push sets tracking via autoSetupRemote)
      await this.gitWorktreeAdd(repoPath, ["--no-track", "-b", branch, dir, base]);
      await this.setBranchBaseConfig(repoPath, branch, base);
    }
    await this.setPushAutoSetupRemote(repoPath);

    // strict verification: a successful exit code is not proof the checkout landed
    const verified = await this.verifyCreated(repoPath, dir, branch);
    if (!verified) {
      throw new Error(`worktree at ${dir} could not be verified after creation`);
    }
    return { dir, branch, headBranch: branch, base, reused: false };
  }

  /**
   * Ordered removal preflight — every gate throws/refuses BEFORE git runs:
   * fresh strict re-list → registered? → dangerous path? → main worktree? →
   * contains a nested registered worktree? → dirty report.
   */
  async preflightRemoval(input: {
    repoPath: string;
    wtPath: string;
    /** the user's home dir (removal-target guard) */
    home?: string;
  }): Promise<PreflightResult> {
    const { repoPath, wtPath, home } = input;
    // 1. fresh strict re-list; refuse unregistered paths outright
    const worktrees = await this.listWorktrees(repoPath);
    const wt = worktrees.find((w) => samePath(w.path, wtPath));
    if (!wt) {
      return { ok: false, dirty: false, reason: `worktree is no longer registered with git: ${wtPath}` };
    }
    // 2. dangerous paths: never remove the repo itself, the fs root, a path that
    //    CONTAINS the repo (repo nested inside the worktree), or the home dir
    if (isDangerousWorktreeRemovalPath(wtPath, repoPath, home)) {
      return { ok: false, dirty: false, reason: `refusing to remove protected path: ${wtPath}` };
    }
    if (wt.isMainWorktree) {
      return { ok: false, dirty: false, reason: "refusing to remove the main working tree" };
    }
    // 3. `git worktree remove --force` treats nested worktrees as ordinary
    //    untracked dirs — their files would be deleted while git keeps a
    //    prunable child registration
    const nested = worktrees.find((w) => !samePath(w.path, wtPath) && containsPath(wtPath, w.path));
    if (nested) {
      return { ok: false, dirty: false, reason: `refusing to remove ${wtPath}: it contains a nested worktree ${nested.path}` };
    }
    // 4. dirty report (last gate; informational — the caller decides on force)
    const dirty = await this.isWorktreeDirty(wtPath);
    return { ok: true, dirty, worktree: wt };
  }

  /**
   * Remove a worktree: preflight → `git worktree remove` → fs fallback →
   * optional merged-only branch delete. The caller is responsible for
   * crash-safety records (the engine manager persists one before calling).
   */
  async removeWorktree(input: RemoveWorktreeInput): Promise<WorktreeRemovalResult> {
    const { repoPath, wtPath, force } = input;
    const preflight = await this.preflightRemoval({ repoPath, wtPath, home: input.home });
    if (!preflight.ok) throw new Error(preflight.reason ?? "worktree removal refused by preflight");
    if (preflight.dirty && !force) {
      throw new Error(`worktree ${wtPath} has uncommitted changes — pass force to remove anyway`);
    }

    let gitRemoved = false;
    try {
      await this.git(["-C", repoPath, "worktree", "remove", wtPath, "--force"], {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      });
      gitRemoved = true;
    } catch { /* fall through to the fs fallback */ }
    if (!fs.existsSync(wtPath)) {
      gitRemoved = true; // registration prune may lag; the dir is what matters
    }
    if (!gitRemoved) {
      try {
        fs.rmSync(wtPath, { recursive: true, force: true });
      } catch (e: unknown) {
        throw new Error(`could not remove worktree dir ${wtPath}: ${e instanceof Error ? e.message : e}`);
      }
    }

    const result: WorktreeRemovalResult = { removed: true, dirGone: !fs.existsSync(wtPath), dirty: preflight.dirty };
    if (input.deleteBranch) {
      // the checked-out branch from the PRE-removal listing — after removal the
      // registration is gone from git, so this is the last chance to know it
      const branch = preflight.worktree ? worktreeBranchName(preflight.worktree) : null;
      if (branch) {
        const deletion = await this.deleteBranchAfterRemoval(repoPath, branch, !!input.forceBranchDelete);
        result.branchDeleted = deletion.deleted;
        result.branchKeptReason = deletion.reason;
      }
    }
    return result;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Prepare the target dir: gone, empty, or an orphaned-worktree dir → clean. */
  private prepareDir(dir: string, worktrees: GitWorktreeInfo[]): void {
    if (!fs.existsSync(dir)) return;
    if (worktrees.some((w) => samePath(w.path, dir))) return; // registered → handled above
    const dotGit = path.join(dir, ".git");
    const empty = fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0;
    const orphanedWorktree = fs.existsSync(dotGit) && fs.lstatSync(dotGit).isFile();
    if (empty || orphanedWorktree) {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
    throw new Error(`refusing to create a worktree over non-empty dir ${dir}`);
  }

  private async gitWorktreeAdd(repoPath: string, args: string[]): Promise<void> {
    try {
      await this.git(["-C", repoPath, "worktree", "add", ...args], {
        timeout: GIT_WORKTREE_ADD_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      });
    } catch (e: any) {
      const msg = String(e?.stderr ?? e?.message ?? e);
      throw new Error(`git worktree add failed: ${msg.trim().slice(0, 500) || (e?.message ?? e)}`);
    }
  }

  /** Resolve the base ref through the same fallback chain as localBranchState. */
  private async resolveBaseRef(repoPath: string, base?: string): Promise<string> {
    const b = base?.trim() || "main";
    const candidates = [
      b.startsWith("refs/") || b.startsWith("origin/") ? b : `origin/${b}`,
      b,
      "origin/master",
      "master",
      "HEAD",
    ];
    for (const cand of candidates) {
      if (await this.refExists(repoPath, cand)) return cand;
    }
    throw new Error(`could not resolve a base ref for the worktree (tried: ${candidates.join(", ")})`);
  }

  private async refExists(repoPath: string, ref: string): Promise<boolean> {
    try {
      await this.git(["-C", repoPath, "rev-parse", "--verify", "--quiet", ref]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Switch a reused worktree to the requested branch: check it out when it
   * exists, else create it from the resolved base. Best-effort — a failed switch
   * leaves the worktree on its current branch (the agent's prompt covers branch
   * creation; localAgent.ensureBranch is the second line of defense).
   */
  private async switchWorktreeBranch(dir: string, branch: string, base?: string): Promise<string | null> {
    const cur = await this.shortHeadBranch(dir);
    if (cur === branch) return branch;
    try {
      if (await this.refExists(dir, `refs/heads/${branch}`)) {
        await this.git(["-C", dir, "checkout", branch], { timeout: GIT_TIMEOUT_MS });
        return branch;
      }
      const baseRef = await this.resolveBaseRef(dir, base);
      await this.git(["-C", dir, "checkout", "-b", branch, baseRef], { timeout: GIT_TIMEOUT_MS });
      return branch;
    } catch (e: unknown) {
      console.warn(`worktree branch switch to ${branch} failed in ${dir}: ${e instanceof Error ? e.message : e}`);
      return await this.shortHeadBranch(dir);
    }
  }

  private async shortHeadBranch(dir: string): Promise<string | null> {
    try {
      const { stdout } = await this.git(["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
      const b = stdout.trim();
      return b && b !== "HEAD" ? b : null;
    } catch {
      return null;
    }
  }

  /** Durable provenance: what the branch was created from (used for diffs/rebase/branch cleanup). */
  private async setBranchBaseConfig(repoPath: string, branch: string, base: string): Promise<void> {
    const key = `branch.${branch}.base`;
    try {
      await this.git(["-C", repoPath, "config", "--local", "--replace-all", key, base]);
    } catch (e: unknown) {
      console.warn(`worktrees: failed to set ${key} — ${e instanceof Error ? e.message : e}`);
      // stale lineage must never be trusted: unset it when the write failed
      await this.git(["-C", repoPath, "config", "--local", "--unset-all", key]).catch(() => {});
    }
  }

  /**
   * A first plain `git push` from a fresh worktree branch then creates and sets
   * origin/<branch> (git ≥2.37; older clients ignore it). Respects an explicit
   * user setting at any scope (`--get` semantics: exit 1 = unset).
   */
  private async setPushAutoSetupRemote(repoPath: string): Promise<void> {
    try {
      try {
        await this.git(["-C", repoPath, "config", "--get", "push.autoSetupRemote"]);
        return; // already set anywhere — don't override the user's choice
      } catch (e: any) {
        // exit 1 = unset (expected); anything else is a real read failure
        if (e?.code !== 1) throw e;
      }
      await this.git(["-C", repoPath, "config", "--local", "push.autoSetupRemote", "true"]);
    } catch (e: unknown) {
      console.warn(`worktrees: failed to set push.autoSetupRemote — ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Prove the create landed: strict re-list first; when the listing omits the
   * new worktree (timing, maintenance locks), probe the created path directly —
   * rev-parse its HEAD, confirm the expected branch is checked out, and confirm
   * it shares this repo's object database. Returns false when unverifiable.
   */
  private async verifyCreated(repoPath: string, dir: string, branch: string): Promise<boolean> {
    try {
      const worktrees = await this.listWorktrees(repoPath);
      if (worktrees.some((w) => samePath(w.path, dir))) return true;
    } catch { /* fall through to the probe */ }
    try {
      const { stdout: head } = await this.git(["-C", dir, "rev-parse", "--verify", "HEAD"]);
      const { stdout: ref } = await this.git(["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
      if (!head.trim() || ref.trim() !== branch) return false;
      // the probe's second opinion: the worktree must share the repo's common dir
      return samePath(await this.absoluteCommonDir(dir), await this.absoluteCommonDir(repoPath));
    } catch {
      return false;
    }
  }

  /**
   * The repo's shared `.git` dir as an absolute path. `--path-format=absolute`
   * (git ≥2.31) avoids the relative-to-cwd spelling older git prints; without
   * it, resolve against the run dir (NOT process.cwd() — that would silently
   * compare against the wrong repo).
   */
  private async absoluteCommonDir(dir: string): Promise<string> {
    try {
      const { stdout } = await this.git(["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
      return stdout.trim();
    } catch {
      const { stdout } = await this.git(["-C", dir, "rev-parse", "--git-common-dir"]);
      return path.resolve(dir, stdout.trim());
    }
  }

  /**
   * Whether a worktree has any uncommitted/untracked change. Public so
   * adapters (flow worktree status, UI) reuse the exact check removal
   * preflight uses — including "unverifiable status counts as dirty".
   */
  async isWorktreeDirty(wtPath: string): Promise<boolean> {
    try {
      const { stdout } = await this.git(
        ["-C", wtPath, "status", "--porcelain", "-z", "--untracked-files=all", "--ignore-submodules=none"],
        { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER }
      );
      return stdout.trim().length > 0;
    } catch {
      return true; // unverifiable status counts as dirty — never force silently
    }
  }

  /**
   * Branch cleanup is separate from worktree removal and MERGED-ONLY by default
   * (Orca semantics): unmerged commits are the work product and survive. The
   * merged proof runs against the branch's recorded base (`branch.<branch>.base`,
   * written at create) before falling back to HEAD.
   */
  private async deleteBranchAfterRemoval(
    repoPath: string,
    branch: string,
    force: boolean
  ): Promise<{ deleted: boolean; reason?: "unmerged" | "checked-out" | "missing" }> {
    try {
      const branchRef = `refs/heads/${branch}`;
      if (!(await this.refExists(repoPath, branchRef))) return { deleted: false, reason: "missing" };

      // fresh worktree registrations can still hold the branch → cannot delete
      try {
        const worktrees = await this.listWorktrees(repoPath);
        if (worktrees.some((w) => worktreeBranchName(w) === branch)) {
          return { deleted: false, reason: "checked-out" };
        }
      } catch { /* strict listing failed — skip the guard, -d still refuses below */ }

      let merged = false;
      const targets: string[] = [];
      try {
        const { stdout } = await this.git(["-C", repoPath, "config", "--get", `branch.${branch}.base`]);
        if (stdout.trim()) targets.push(stdout.trim());
      } catch { /* no recorded base */ }
      targets.push("HEAD");
      for (const target of targets) {
        try {
          const { stdout: oid } = await this.git(["-C", repoPath, "rev-parse", "--verify", `${target}^{commit}`]);
          // exit 0 = the branch tip is an ancestor of the target → fully merged
          await this.git(["-C", repoPath, "merge-base", "--is-ancestor", branchRef, oid.trim()]);
          merged = true;
          break;
        } catch { /* try next target */ }
      }
      if (!merged && !force) return { deleted: false, reason: "unmerged" };
      await this.git(["-C", repoPath, "branch", force ? "-D" : "-d", branch]);
      return { deleted: true };
    } catch (e: unknown) {
      console.warn(`worktrees: branch cleanup for ${branch} failed — ${e instanceof Error ? e.message : e}`);
      return { deleted: false };
    }
  }

  /** Run a git command (never hangs the engine: bounded timeouts). */
  private async git(
    args: string[],
    opts: { timeout?: number; maxBuffer?: number } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("git", args, {
      maxBuffer: opts.maxBuffer ?? MAX_BUFFER,
      timeout: opts.timeout ?? GIT_TIMEOUT_MS,
    });
  }
}

/** Shared worktree mechanics (stateless enough that a module-scoped singleton is safe — same as localGit). */
export const worktrees = new Worktrees();
