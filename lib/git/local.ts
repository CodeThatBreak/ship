import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { config } from "../config";
import { gitHostRegistry } from "../engine/ports/git-host";

const execFileAsync = promisify(execFile);

// never let a git command hang the engine (SSH connect can stall ~75s on a dead remote)
const GIT_TIMEOUT_MS = 20_000;
const GIT_FETCH_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 1024 * 1024 * 50;

export interface DiffFile {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
}

export interface LocalBranchState {
  exists: boolean;
  commitsAhead: number;
  base: string;
  stat: string;
  raw: string;
  pushed: boolean;
}

/**
 * Local git operations: per-flow clones, branch diffs, pushes and worktrees.
 * Prefers the repo's registered local checkout when available, falling back
 * to a per-flow clone under workspaces/.
 */
export class LocalGit {
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

  private authedUrl(repoUrl: string): string {
    // the token-embedding scheme (oauth2:<token>@) is the host adapter's —
    // routing to the right instance lives in the git-host registry
    try {
      return gitHostRegistry.forRepo(repoUrl).authedCloneUrl(repoUrl);
    } catch {
      return repoUrl;
    }
  }

  cloneDir(flowId: string): string {
    return path.join(config.workspace.dir(), flowId);
  }

  /** Clone (or reuse) a repo for a flow and fetch a branch. */
  async ensureClone(flowId: string, repoUrl: string): Promise<string> {
    const dir = this.cloneDir(flowId);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (!fs.existsSync(path.join(dir, ".git"))) {
      await this.git(["clone", "--no-checkout", this.authedUrl(repoUrl), dir], {
        timeout: GIT_FETCH_TIMEOUT_MS * 8,
      });
    }
    await this.git(["-C", dir, "fetch", "origin", "--prune"], { timeout: GIT_FETCH_TIMEOUT_MS });
    return dir;
  }

  async fetchBranch(flowId: string, repoUrl: string, branch: string): Promise<string> {
    const dir = await this.ensureClone(flowId, repoUrl);
    await this.git(["-C", dir, "fetch", "origin", branch], { timeout: GIT_FETCH_TIMEOUT_MS }).catch(() => {});
    return dir;
  }

  /**
   * Diff a branch against a base ref.
   * Uses the repo's registered local checkout when available (fetching first),
   * otherwise the per-flow clone under workspaces/.
   */
  async diffBranch(
    flowId: string,
    repoUrl: string,
    branch: string,
    baseRef?: string,
    localPath?: string | null
  ): Promise<{ files: DiffFile[]; stat: string; raw: string }> {
    let dir: string;
    if (localPath && fs.existsSync(path.join(localPath, ".git"))) {
      dir = localPath;
      await this.git(["-C", dir, "fetch", "origin", "--prune"], { timeout: GIT_FETCH_TIMEOUT_MS }).catch(() => {});
      await this.git(["-C", dir, "fetch", "origin", branch], { timeout: GIT_FETCH_TIMEOUT_MS }).catch(() => {});
    } else {
      dir = await this.fetchBranch(flowId, repoUrl, branch);
    }
    const target = `origin/${branch}`;
    // make sure base exists; fall back to master
    let base = baseRef ?? "origin/main";
    try {
      await this.git(["-C", dir, "rev-parse", "--verify", base]);
    } catch {
      base = "origin/master";
    }
    const { stdout: raw } = await this.git(["-C", dir, "diff", `${base}...${target}`]);
    const { stdout: stat } = await this.git(["-C", dir, "diff", "--stat", `${base}...${target}`]);
    return { files: this.parseDiff(raw), stat, raw };
  }

  /** Current branch of a local checkout (null on error / detached). */
  async currentBranch(localPath: string): Promise<string | null> {
    try {
      const { stdout } = await this.git(["-C", localPath, "rev-parse", "--abbrev-ref", "HEAD"]);
      const b = stdout.trim();
      return b && b !== "HEAD" ? b : null;
    } catch {
      return null;
    }
  }

  /**
   * Push a local branch to origin. Tries the configured remote first (user's git
   * credentials — local-mode philosophy), then falls back to the token-authed
   * HTTPS URL, which often works when SSH is blocked. Throws with a clear error.
   */
  async pushBranch(localPath: string, branch: string, repoUrl?: string): Promise<"origin" | "https"> {
    const base = ["-C", localPath];
    const opts = { timeout: GIT_FETCH_TIMEOUT_MS };
    try {
      await this.git([...base, "push", "-u", "origin", branch], opts);
      return "origin";
    } catch (e: any) {
      if (!repoUrl) throw new Error(`git push failed: ${e?.message ?? e}`);
    }
    let lastErr: any = null;
    // retry once: local pre-push hooks (type checks) can flake, and a push that
    // got killed mid-hook may have actually landed — "Everything up-to-date" then
    // succeeds on the retry
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.git([...base, "push", this.authedUrl(repoUrl), `${branch}:${branch}`], opts);
        // keep origin/<branch> in sync for later diffs
        await this.git([...base, "fetch", "origin", branch], opts).catch(() => {});
        return "https";
      } catch (e: any) {
        lastErr = e;
      }
    }
    throw new Error(
      `could not push branch ${branch} — check VPN/network access to the git host and your git credentials (${String(lastErr?.message ?? lastErr).slice(0, 300)})`
    );
  }

  /**
   * Ground-truth state of a local branch vs its base — works even when the
   * branch was never pushed (unlike diffBranch, which needs origin/<branch>).
   * Used to recover build runs that were orphaned by a server restart.
   */
  async localBranchState(
    localPath: string,
    branch: string,
    baseBranch = "main"
  ): Promise<LocalBranchState> {
    const none: LocalBranchState = { exists: false, commitsAhead: 0, base: baseBranch, stat: "", raw: "", pushed: false };
    const base = ["-C", localPath];
    try {
      await this.git([...base, "rev-parse", "--verify", "--quiet", branch]);
    } catch {
      return none;
    }
    // best available base ref: fetched origin/<base> first, then local <base>/master
    let baseRef = `origin/${baseBranch}`;
    for (const cand of [baseRef, baseBranch, "origin/master", "master"]) {
      try {
        await this.git([...base, "rev-parse", "--verify", cand]);
        baseRef = cand;
        break;
      } catch { /* try next */ }
    }
    const { stdout: count } = await this.git([...base, "rev-list", "--count", `${baseRef}..${branch}`]);
    const commitsAhead = parseInt(count.trim(), 10) || 0;
    const { stdout: raw } = await this.git([...base, "diff", `${baseRef}...${branch}`]);
    const { stdout: stat } = await this.git([...base, "diff", "--stat", `${baseRef}...${branch}`]);
    const pushed = await this.git([...base, "rev-parse", "--verify", "--quiet", `origin/${branch}`])
      .then(() => true)
      .catch(() => false);
    return { exists: true, commitsAhead, base: baseRef, stat, raw, pushed };
  }

  // ── Phase 3C: worktree helpers for parallel local builds ────────────────

  /** Create a git worktree for a branch. Returns the worktree path. */
  async addWorktree(repoPath: string, branch: string, baseBranch = "main"): Promise<string> {
    const wtPath = path.join(repoPath, ".worktrees", branch.replace(/[^a-zA-Z0-9_-]/g, "_"));
    // Ensure the branch exists (create from base if needed)
    try {
      await this.git(["-C", repoPath, "rev-parse", "--verify", branch]);
    } catch {
      await this.git(["-C", repoPath, "branch", branch, baseBranch]);
    }
    await this.git(["-C", repoPath, "worktree", "add", wtPath, branch], {
      maxBuffer: 1024 * 1024 * 10,
      timeout: GIT_TIMEOUT_MS * 3,
    });
    return wtPath;
  }

  /** Remove a git worktree. Best-effort cleanup. */
  async removeWorktree(repoPath: string, wtPath: string): Promise<void> {
    try {
      await this.git(["-C", repoPath, "worktree", "remove", wtPath, "--force"]);
    } catch {
      // Also try to remove the directory if git worktree remove fails
      try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  private parseDiff(raw: string): DiffFile[] {
    const files: DiffFile[] = [];
    const chunks = raw.split(/^diff --git /m).filter(Boolean);
    for (const c of chunks) {
      const head = c.split("\n", 1)[0];
      const m = head.match(/a\/(.+?) b\/(.+)/);
      const file = m ? m[2] : head;
      let additions = 0;
      let deletions = 0;
      for (const line of c.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
      files.push({ file, patch: "diff --git " + c, additions, deletions });
    }
    return files;
  }
}

export const localGit = new LocalGit();

/** The per-flow workspace clone directory (`workspaces/<flowId>`), or null when absent. */
export function workspaceForFlow(flowId: string): string | null {
  const dir = path.join(config.workspace.dir(), flowId);
  try {
    return fs.existsSync(path.join(dir, ".git")) ? dir : null;
  } catch {
    return null;
  }
}
