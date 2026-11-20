import "server-only";

import { db, type Repo } from "../../../db/app";
import { depPolicies, type RepoDepOverrides } from "../../../git/depPolicy";
import { worktreeSetup } from "../../../git/worktreeSetup";
import type { FlowCtx } from "../../nodes/shared/runContext";
import type { WorktreeActivity } from "./worktreeActivity";

/**
 * WorktreeDepSetup — runs the repo's dependency-setup policy inside a freshly
 * created worktree (policy resolved from lib/git/depPolicy.ts, executed by
 * lib/git/worktreeSetup.ts).
 *
 * Invariant: deps setup FAILS NON-FATALLY — the failure comes back as a
 * one-line `setupNote` (surfaced on the agent's run prompt so the agent can
 * self-repair), never as a thrown error and never as a skipped run. Deps
 * setup runs once per flow (the worktree persists build → fixes → re-gates →
 * resolve, including session resumes); reuse skips it.
 *
 * Must-never: never throw out of the setup run (the executor reports failures
 * as results — a throw here is a bug in that contract); never make a setup
 * failure fatal to the node.
 */
export class WorktreeDepSetup {
  constructor(private readonly activity: WorktreeActivity) {}

  /**
   * Run the repo's dependency-setup policy in a freshly created worktree.
   * Emits a lifecycle event like any other step ("setting up worktree deps…"),
   * is time-bounded by the policy, and FAILS NON-FATALLY: the returned note
   * ("worktree deps setup failed: <err>") goes on the agent's run prompt so
   * the agent can self-repair by running the repo's setup itself.
   */
  async setupFlowWorktree(
    ctx: FlowCtx,
    target: { dir: string; hub: string; nodeId: string | null }
  ): Promise<string | null> {
    const overrides = this.depOverrides(ctx.repo);
    const policy = depPolicies.resolve({
      hubPath: target.hub,
      overrides,
    });
    await db.emitEvent(ctx.flow.id, target.nodeId, "lifecycle",
      `setting up worktree deps (${policy.source})…`,
      await this.activity.lifecycleData(ctx.flow.id, target.nodeId, {
        policy: policy.source,
        strategy: policy.strategy,
      }));
    await this.activity.touchNode(ctx.flow.id, target.nodeId);
    const note = (err: string) => `worktree deps setup failed: ${err}`;
    try {
      const result = await worktreeSetup.run({
        hubPath: target.hub,
        worktreePath: target.dir,
        policy,
        syncGlobs: depPolicies.resolveSyncGlobs(overrides),
        sharedDirs: depPolicies.parsePathList(overrides.shared_dirs),
        setupCommand: overrides.setup_command ?? null,
        onEvent: async (message) => {
          await db.emitEvent(ctx.flow.id, target.nodeId, "log", message,
            await this.activity.lifecycleData(ctx.flow.id, target.nodeId));
          await this.activity.touchNode(ctx.flow.id, target.nodeId);
        },
      });
      const message = result.ok
        ? `worktree deps ready${result.actions.length ? `: ${result.actions.join("; ")}` : ""}`
        : note(result.error ?? "unknown error");
      await db.emitEvent(ctx.flow.id, target.nodeId, result.ok ? "lifecycle" : "error", message,
        await this.activity.lifecycleData(ctx.flow.id, target.nodeId, { actions: result.actions }));
      await this.activity.touchNode(ctx.flow.id, target.nodeId);
      return result.ok ? null : message;
    } catch (e: unknown) {
      // the executor reports failures as results — a throw here is a bug
      const msg = e instanceof Error ? e.message : String(e);
      await db.emitEvent(ctx.flow.id, target.nodeId, "error", note(msg), await this.activity.lifecycleData(ctx.flow.id, target.nodeId));
      return note(msg);
    }
  }

  /** The repo row's policy overrides, normalized for the pure dep-policy layer. */
  depOverrides(repo: Repo | null | undefined): RepoDepOverrides {
    if (!repo) return {};
    return {
      install_command: repo.installCommand,
      skip_install: Boolean(repo.skipInstall),
      setup_command: repo.setupCommand,
      sync_paths: repo.syncPaths,
      shared_dirs: repo.sharedDirs,
    };
  }
}
