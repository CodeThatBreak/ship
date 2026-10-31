import "server-only";

import fs from "fs";
import path from "path";
import { processSingleton } from "../singleton";
import { localBranchBaseCandidates } from "./base-ref";
import { AuthedUrlResolutionError } from "./git-errors";
import {
  GitRunner,
  GIT_FETCH_TIMEOUT_MS,
  gitRunner,
} from "./git-runner";
import { workspacePaths } from "./workspace-paths";

export interface DiffFile {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
}

export interface LocalBranchState {
  exists: boolean;
  commitsAhead: number;
  /** commits on the base ref that the branch hasn't picked up yet (0 when current) */
  commitsBehind: number;
  base: string;
  stat: string;
  raw: string;
  pushed: boolean;
}

/**
 * Resolves the token-authed clone/push URL for a repo. The engine supplies it
 * (via the git-host registry) so this module stays free of engine imports.
 */
export type AuthedUrlResolver = (repoUrl: string) => string;

/**
 * Local git operations: per-flow clones, branch diffs, pushes and worktrees.
 * Prefers the repo's registered local checkout when available, falling back
 * to a per-flow clone under workspaces/.
 */
export class LocalGit {
  constructor(private readonly gitExec: GitRunner = gitRunner) {}

  /** Run a git command (never hangs the engine: bounded timeouts). */
  private async git(
    args: string[],
    opts: { timeout?: number; maxBuffer?: number } = {},
  ): Promise<{ stdout: string; stderr: string }> {
    return this.gitExec.run(args, opts);
  }

  private authedUrl(repoUrl: string, resolve?: AuthedUrlResolver): string {
    if (!resolve) return repoUrl;
    try {
      return resolve(repoUrl);
    } catch (e: unknown) {
      throw new AuthedUrlResolutionError(repoUrl, e);
    }
  }

  cloneDir(flowId: string): string {
    return workspacePaths.cloneDir(flowId);
  }

  /** Clone (or reuse) a repo for a flow and fetch a branch. */
  async ensureClone(flowId: string, repoUrl: string, resolveAuthedUrl?: AuthedUrlResolver): Promise<string> {
    const dir = this.cloneDir(flowId);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (!fs.existsSync(path.join(dir, ".git"))) {
      await this.git(["clone", "--no-checkout", this.authedUrl(repoUrl, resolveAuthedUrl), dir], {
        timeout: GIT_FETCH_TIMEOUT_MS * 8,
      });
    }
    await this.git(["-C", dir, "fetch", "origin", "--prune"], { timeout: GIT_FETCH_TIMEOUT_MS });
    return dir;
  }

  async fetchBranch(flowId: string, repoUrl: string, branch: string, resolveAuthedUrl?: AuthedUrlResolver): Promise<string> {
    const dir = await this.ensureClone(flowId, repoUrl, resolveAuthedUrl);
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
    localPath?: string | null,
    resolveAuthedUrl?: AuthedUrlResolver
  ): Promise<{ files: DiffFile[]; stat: string; raw: string }> {
    let dir: string;
    if (localPath && fs.existsSync(path.join(localPath, ".git"))) {
      dir = localPath;
      await this.git(["-C", dir, "fetch", "origin", "--prune"], { timeout: GIT_FETCH_TIMEOUT_MS }).catch(() => {});
      await this.git(["-C", dir, "fetch", "origin", branch], { timeout: GIT_FETCH_TIMEOUT_MS }).catch(() => {});
    } else {
      dir = await this.fetchBranch(flowId, repoUrl, branch, resolveAuthedUrl);
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
  async pushBranch(
    localPath: string,
    branch: string,
    repoUrl?: string,
    resolveAuthedUrl?: AuthedUrlResolver
  ): Promise<"origin" | "https"> {
    const base = ["-C", localPath];
    const opts = { timeout: GIT_FETCH_TIMEOUT_MS };
    try {
      await this.git([...base, "push", "-u", "origin", branch], opts);
      return "origin";
    } catch (e: unknown) {
      if (!repoUrl) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`git push failed: ${msg}`);
      }
    }
    let lastErr: unknown = null;
    // retry once: local pre-push hooks (type checks) can flake, and a push that
    // got killed mid-hook may have actually landed — "Everything up-to-date" then
    // succeeds on the retry
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.git([...base, "push", this.authedUrl(repoUrl, resolveAuthedUrl), `${branch}:${branch}`], opts);
        // keep origin/<branch> in sync for later diffs
        await this.git([...base, "fetch", "origin", branch], opts).catch(() => {});
        return "https";
      } catch (e: unknown) {
        lastErr = e;
      }
    }
    const lastMsg =
      lastErr instanceof Error ? lastErr.message : lastErr != null ? String(lastErr) : "unknown error";
    throw new Error(
      `could not push branch ${branch} — check VPN/network access to the git host and your git credentials (${lastMsg.slice(0, 300)})`
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
    const none: LocalBranchState = { exists: false, commitsAhead: 0, commitsBehind: 0, base: baseBranch, stat: "", raw: "", pushed: false };
    const base = ["-C", localPath];
    try {
      await this.git([...base, "rev-parse", "--verify", "--quiet", branch]);
    } catch {
      return none;
    }
    // best available base ref: fetched origin/<base> first, then local <base>/master
    let baseRef = `origin/${baseBranch}`;
    for (const cand of localBranchBaseCandidates(baseBranch)) {
      try {
        await this.git([...base, "rev-parse", "--verify", cand]);
        baseRef = cand;
        break;
      } catch { /* try next */ }
    }
    const { stdout: count } = await this.git([...base, "rev-list", "--count", `${baseRef}..${branch}`]);
    const commitsAhead = parseInt(count.trim(), 10) || 0;
    const { stdout: behindCount } = await this.git([...base, "rev-list", "--count", `${branch}..${baseRef}`]);
    const commitsBehind = parseInt(behindCount.trim(), 10) || 0;
    const { stdout: raw } = await this.git([...base, "diff", `${baseRef}...${branch}`]);
    const { stdout: stat } = await this.git([...base, "diff", "--stat", `${baseRef}...${branch}`]);
    const pushed = await this.git([...base, "rev-parse", "--verify", "--quiet", `origin/${branch}`])
      .then(() => true)
      .catch(() => false);
    return { exists: true, commitsAhead, commitsBehind, base: baseRef, stat, raw, pushed };
  }

  // ── worktrees ────────────────────────────────────────────────────────────
  // Moved to lib/git/worktrees.ts (Phase 1): the pure worktree layer
  // (create/list/preflight/remove + porcelain parsing), consumed via the
  // engine adapter in lib/engine/worktree-lifecycle.ts.

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

export const localGit = processSingleton("localGit", () => new LocalGit());

/** The per-flow workspace clone directory (`workspaces/clones/<flowId>`), or null when absent. */
export function workspaceForFlow(flowId: string): string | null {
  const dir = workspacePaths.cloneDir(flowId);
  try {
    const dotGit = path.join(dir, ".git");
    if (!fs.existsSync(dotGit)) return null;
    return fs.lstatSync(dotGit).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}
