import "server-only";

import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { db } from "../../../db";
import { localGit } from "../../../git/local";
import { redactGitSecrets } from "../../../git/redact-git-secrets";
import { workspacePaths } from "../../../git/workspace-paths";
import { processSingleton } from "../../../singleton";
import { gitRemoteContextFor } from "../../ports/git-host";
import { isHookRejection } from "../../nodes/kinds/merge-request";
import type { MergeBackArgs, MergeBackResult } from "../../nodes/shared/capabilities";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 1024 * 1024 * 50;

/**
 * The merge arena (plan fan-out, Phase 1 merge-back + Phase 2 failure paths):
 * the one engine op that lands an approved step child's branch onto the
 * parent's integration branch.
 *
 * Arena choice: a dedicated per-parent clone (`workspaces/arenas/<parentFlowId>`)
 * — created lazily, never the developer's hub checkout (which is never touched,
 * even in local mode) and never the parent flow's own worktree (a worktree
 * checked out on the agent's branch cannot legally `git checkout` the
 * integration branch). The plan's "local mode uses the parent's flow worktree"
 * shortcut is deliberately not taken: a dedicated arena clone sidesteps
 * checkout conflicts between the running build worktree and the merge, and
 * keeps both modes on one code path (recorded as an implementation note —
 * revisit if arena clone cost becomes a concern).
 *
 * Serialization: an in-memory lock per parent flow (all integration branches
 * share one arena checkout). Durable `step_merges`
 * rows are written BEFORE any git command and updated after, so Phase 2's
 * reconcile can resume/flag a merge that a server restart interrupted.
 *
 * Push options caveat (Phase 2, documented): every ENGINE-driven push here —
 * the integration-branch merge push, the step-branch deletion push — carries
 * `-o ci.skip` (with a plain fallback for hosts that reject push options) so
 * engine ops never spawn CI. Agent-initiated pushes CANNOT carry push options:
 * the merge-fix / commit-fix agent pushes the step branch itself, so
 * repo-side CI rules scoped to the step-branch pattern are the mitigation.
 */
class MergeArena {
  /** chained in-flight merges per parent flow (one arena dir per parent) */
  private locks = new Map<string, Promise<void>>();

  /**
   * Merge attempts this process currently runs, keyed by child flow id —
   * the reconcile pass consults it so a resume never double-books a merge
   * that is still in flight in the live process.
   */
  private inFlight = new Set<string>();

  /** True when a merge attempt is in flight in this process for the child. */
  isMerging(childFlowId: string): boolean {
    return this.inFlight.has(childFlowId);
  }

  /**
   * Per-parent-flow merge locks serialize integration-branch pushes. The lock
   * chain's promises always settle; dropping entries under a live queue would
   * let a concurrently queued sibling merge run beside the in-flight one.
   */

  /** Serialize one integration branch's merges: second approval queues behind the first. */
  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.locks.set(
      key,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  }

  /** The arena dir for a parent flow: reused clone under workspaces/arenas/ (lazy create). */
  private async ensureWorkspace(parentFlowId: string, repoUrl: string): Promise<string> {
    return this.ensureWorkspaceUnlocked(parentFlowId, repoUrl);
  }

  private async git(
    args: string[],
    opts: {
      timeout?: number;
      maxBuffer?: number;
      env?: Record<string, string>;
      redactSecrets?: readonly string[];
    } = {},
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileAsync("git", args, {
        maxBuffer: opts.maxBuffer ?? MAX_BUFFER,
        timeout: opts.timeout ?? GIT_TIMEOUT_MS,
        env: opts.env ? ({ ...process.env, ...opts.env } as NodeJS.ProcessEnv) : process.env,
      });
    } catch (e: unknown) {
      const err = (typeof e === "object" && e !== null ? e : {}) as {
        stderr?: unknown;
        stdout?: unknown;
        message?: unknown;
      };
      const text = redactGitSecrets(
        `${String(err.stderr ?? "")}\n${String(err.stdout ?? "")}\n${String(err.message ?? e)}`,
        opts.redactSecrets ?? [],
      );
      throw new Error(text.trim() || String(e));
    }
  }

  /**
   * One arena attempt (steps 1–2.5 of the plan; the RETRY loop lives in the
   * StepFlowManager because the merge-fix agent runs on it): serialize →
   * fetch/checkout/pull ff-only → stale-base check → `merge --no-ff` → push
   * (`ci.skip`, plain fallback) → delete the step branch (`ci.skip`, plain
   * fallback). Classified result: `conflict` / `rejected` are repairable CODE
   * states the bounded merge-fix agent owns; every other throw is infra and
   * fails visible. Conflicts and hook rejections are persisted in
   * `step_merges` («running» → «conflict»/«failed») so reconcile after a
   * restart resumes or flags.
   */
  async mergeStepBranch(args: MergeBackArgs): Promise<MergeBackResult> {
    const key = args.parentFlowId;
    const ts = () => db.now();
    // one durable row per attempt SERIES — a re-attempt (merge-fix / reconcile
    // resume) updates the same row and increments `attempts`
    let rowId = args.mergeRowId ?? null;
    if (rowId) {
      db.run(
        `UPDATE step_merges SET status='running', attempts=attempts+1, error=NULL, updated_at=? WHERE id=?`,
        ts(), rowId
      );
      rowId = db.get<{ id: string }>(`SELECT id FROM step_merges WHERE id=?`, rowId)?.id ?? null;
    }
    if (!rowId) {
      rowId = db.uid("sm_");
      db.run(
        `INSERT INTO step_merges (id,flow_id,parent_flow_id,parent_node,branch,status,attempts,created_at,updated_at)
         VALUES (?,?,?,?,?,'running',1,?,?)`,
        rowId, args.childFlowId, args.parentFlowId, args.parentNodeKey, args.branch, ts(), ts()
      );
    }
    this.inFlight.add(args.childFlowId);
    try {
      const result = await this.withLock(key, async () => {
        const flow = db.get<{ repo_url: string | null; execution_mode: string | null }>(
          `SELECT repo_url, execution_mode FROM flows WHERE id=?`, args.parentFlowId
        );
        const repoUrl = flow?.repo_url ?? "";
        if (!repoUrl) return { status: "failed" as const, error: "the parent flow has no repo url" };
        const known = db.repoByCloudUrl(repoUrl);
        const baseBranch = known?.default_branch ?? args.baseBranch;
        const arena = await this.ensureWorkspace(args.parentFlowId, repoUrl);

        try { await this.git(["-C", arena, "merge", "--abort"]); } catch { /* no merge in progress */ }
        try { await this.git(["-C", arena, "reset", "--hard"]); } catch { /* best effort clean */ }

        // checkout the integration branch: off the pushed head when it exists
        // (a prior merge group), else off the repo default
        const hasIntegration = await this.git(
          ["-C", arena, "rev-parse", "--verify", "--quiet", `origin/${args.integrationBranch}`]
        ).then(() => true).catch(() => false);
        await this.git(["-C", arena, "checkout", "-B", args.integrationBranch,
          hasIntegration ? `origin/${args.integrationBranch}` : `origin/${baseBranch}`]);
        if (hasIntegration) {
          await this.git(["-C", arena, "pull", "--ff-only"]).catch(() => null);
        }

        // the step branch must have been pushed by the child build agent
        await this.git(["-C", arena, "fetch", "origin", args.branch], { timeout: 30_000 });
        const stepRef = `origin/${args.branch}`;
        await this.git(["-C", arena, "cat-file", "-e", `${stepRef}^{commit}`]);

        // Stale base (plan §4.6): the step branch was cut before earlier
        // siblings merged, so the integration head is not an ancestor of it —
        // the branch diverges. The repair is a MERGE (never a rebase): a clean
        // merge lands it right here; a conflicting merge goes to the merge-fix
        // agent below. Either way the divergence is surfaced on the parent.
        let stale = false;
        if (hasIntegration) {
          const isAncestor = await this.git(
            ["-C", arena, "merge-base", "--is-ancestor", `origin/${args.integrationBranch}`, stepRef]
          ).then(() => true).catch(() => false);
          stale = !isAncestor;
          if (stale) {
            db.emitEvent(args.parentFlowId, null, "lifecycle",
              `merge-back: step branch ${args.branch} is stale against ${args.integrationBranch} — landing with a merge commit (never rebased)`,
              { nodeKey: args.parentNodeKey, branch: args.branch, staleBase: true });
          }
        }

        let conflictText: string | null = null;
        try {
          await this.git(["-C", arena, "merge", "--no-ff", stepRef, "-m", args.message]);
        } catch (e: unknown) {
          const err = (e as { stderr?: string; stdout?: string; message?: string });
          const text = `${err.stderr ?? ""}\n${err.stdout ?? ""}\n${err.message ?? ""}`;
          if (/CONFLICT|Automatic merge failed/i.test(text)) {
            conflictText = text.trim().split("\n").filter((l) => /conflict/i.test(l)).slice(0, 8).join("\n")
              || "merge conflict while landing the step branch";
          } else {
            throw e;
          }
        }
        if (conflictText) {
          db.emitEvent(args.parentFlowId, null, "error",
            `step "${args.branch}" merge-back CONFLICT against ${args.integrationBranch} — running the bounded merge-fix agent`,
            { nodeKey: args.parentNodeKey, childFlowId: args.childFlowId, branch: args.branch });
          db.run(`UPDATE step_merges SET status='conflict', error=?, updated_at=? WHERE id=?`,
            conflictText, ts(), rowId);
          return { status: "conflict" as const, error: conflictText };
        }

        // push the integration branch (ci.skip push option: engine-driven pushes
        // must not spawn CI; the plain push retries once without the option on
        // hosts that reject push options — agent-initiated pushes can't carry
        // push options at all, see the class doc caveat)
        try {
          await this.git(["-C", arena, "push", "-o", "ci.skip", "origin", args.integrationBranch]);
        } catch (e: unknown) {
          const text = this.errorText(e);
          if (isHookRejection(text)) {
            // pre-receive/pre-push hook declined the integration push —
            // repairable CODE state → the StepFlowManager's bounded fix agent
            db.run(`UPDATE step_merges SET status='rejected', error=?, updated_at=? WHERE id=?`,
              text.slice(0, 2000), ts(), rowId);
            db.emitEvent(args.parentFlowId, null, "error",
              `merge-back: pushing ${args.integrationBranch} was rejected by a hook — running the bounded commit-fix agent`,
              { nodeKey: args.parentNodeKey, childFlowId: args.childFlowId, branch: args.branch });
            return { status: "rejected" as const, error: text.slice(0, 2000) };
          }
          // one plain retry for hosts that don't support push options at all
          try {
            await this.git(["-C", arena, "push", "origin", args.integrationBranch]);
          } catch (e2: unknown) {
            const text2 = this.errorText(e2);
            if (isHookRejection(text2)) {
              db.run(`UPDATE step_merges SET status='rejected', error=?, updated_at=? WHERE id=?`,
                text2.slice(0, 2000), ts(), rowId);
              return { status: "rejected" as const, error: text2.slice(0, 2000) };
            }
            throw e2; // network / auth — infra, fails visible for manual retry
          }
        }
        // success: the step branch was a scoping unit, not an MR unit — delete
        // it from origin too (best effort; ci.skip + plain fallback)
        await this.deleteStepBranch(args.parentFlowId, args.branch).catch(() => null);
        db.run(`UPDATE step_merges SET status='merged', error=?, updated_at=? WHERE id=?`,
          stale ? "merged — the branch was stale against the integration branch" : null, ts(), rowId);
        return { status: "merged" as const, ...(stale ? { stale: true } : {}) };
      });
      return result;
    } catch (e: unknown) {
      // push rejection (non-hook-shaped but both fallbacks failed) / network /
      // pre-receive infra — surfaced to the developer (goes to failed; the
      // retry path re-runs the merge)
      const msg = this.errorText(e).slice(0, 2000);
      db.run(`UPDATE step_merges SET status='failed', error=?, updated_at=? WHERE id=?`, msg, ts(), rowId);
      return { status: "failed" as const, error: msg };
    } finally {
      this.inFlight.delete(args.childFlowId);
    }
  }

  /**
   * Best-effort push-deletion of a step branch from origin (skip / abandoned
   * hygiene — a merged branch is deleted inside mergeStepBranch). Engine-driven
   * ⇒ `ci.skip` first, plain fallback; a branch deletion never spawns a
   * pipeline on hosts that accept push options, so failures here are swallowed.
   */
  async deleteStepBranch(parentFlowId: string, branch: string, parentNodeKey?: string): Promise<void> {
    await this.withLock(parentFlowId, async () => {
      const parent = db.get<{ repo_url: string | null }>(`SELECT repo_url FROM flows WHERE id=?`, parentFlowId);
      const repoUrl = parent?.repo_url;
      if (!repoUrl) return;
      const arena = await this.ensureWorkspaceUnlocked(parentFlowId, repoUrl);
      try {
        await this.git(["-C", arena, "push", "-o", "ci.skip", "origin", `:${branch}`]);
      } catch {
        await this.git(["-C", arena, "push", "origin", `:${branch}`]);
      }
      if (parentNodeKey) {
        db.emitEvent(parentFlowId, null, "lifecycle",
          `step branch ${branch} deleted from origin (merge/skip hygiene)`,
          { nodeKey: parentNodeKey, branch });
      }
    });
  }

  /** Lazy arena setup — call only while holding the parent-flow merge lock. */
  private async ensureWorkspaceUnlocked(parentFlowId: string, repoUrl: string): Promise<string> {
    const dir = workspacePaths.mergeArenaDir(parentFlowId);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await localGit.ensureClone(parentFlowId, repoUrl, gitRemoteContextFor).catch(() => null);
    if (!fs.existsSync(path.join(dir, ".git"))) {
      const remote = gitRemoteContextFor(repoUrl);
      await this.git(["clone", "--no-checkout", remote.cloneUrl, dir], {
        timeout: 300_000,
        env: remote.env,
        redactSecrets: remote.redactSecrets,
      });
    }
    await this.git(["-C", dir, "fetch", "origin", "--prune"], { timeout: 30_000 });
    return dir;
  }

  private errorText(e: unknown): string {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    const text = `${err?.stderr ?? ""}\n${err?.stdout ?? ""}\n${err?.message ?? String(e)}`;
    return redactGitSecrets(
      text.trim().split("\n").filter(Boolean).slice(-8).join("\n") || String(e),
    );
  }
}

export const mergeArena = processSingleton("mergeArena", () => new MergeArena());
