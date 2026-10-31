import "server-only";

import { db } from "../../../../db";
import { localGit } from "../../../../git/local";
import { authedCloneUrlFor, gitHostRegistry, type ChangeRequest } from "../../../ports/git-host";
import { flowCtxHelper, nodeSupport, type FlowCtx } from "../../shared";
import { branchStore } from "../build";
import { NODE_KEYS } from "../../../constants/node-keys";

/**
 * MR-creation failure that an agent can plausibly fix in the build step —
 * a rejected push (pre-push/pre-receive hooks, type checks, lint gates).
 * Network/auth/API failures are thrown as plain Errors (manual retry).
 */
export class CommitError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = "CommitError";
  }
}

/** True when an error looks like a code/hook rejection rather than infra. */
export function isCommitError(e: unknown): e is CommitError {
  return e instanceof CommitError;
}

// push/hook rejection signatures — everything else (network, auth, DNS, 5xx)
// is infra and surfaces to the user for manual retry
const HOOK_PATTERNS = [
  /pre-receive/i,
  /pre-push/i,
  /hook declined/i,
  /push declined/i,
  /rejected.*hook/i,
  /hook.*reject/i,
  /! \[remote rejected\]/i,
  /error: failed to push some refs/i,
];

/**
 * True when a push failure looks like a code/hook rejection rather than infra
 * (merge-request-service owns the signatures; the merge arena's Phase-2
 * classification reuses them verbatim so "repairable code state vs infra
 * failure" is decided the same way in both paths).
 */
export function isHookRejection(text: string): boolean {
  return HOOK_PATTERNS.some((p) => p.test(text));
}

/**
 * Create (or reuse) the git-host change request (MR/PR) for a built branch,
 * then reset the pipeline + review nodes to pending. Shared by single- and
 * multi-branch flows.
 *
 * This is an operation on the graph rather than a node itself — it sits
 * between build approval and the pipeline gate.
 */
export class MergeRequestService {
  async create(ctx: FlowCtx, branchName?: string, opts: { emitNodeKey?: string } = {}): Promise<ChangeRequest> {
    const flow = ctx.flow;
    const gitBranch = branchName ? flowCtxHelper.buildBranch(ctx, branchName) : flow.mr_branch;
    if (!gitBranch) throw new Error("no build branch to create an MR from");

    // Local mode: the branch may exist only in the local checkout (the agent
    // commits locally; a restart may have killed the run before it pushed).
    if (flowCtxHelper.execMode(ctx) === "local") {
      const lp = flowCtxHelper.localPath(ctx);
      if (lp) {
        db.emitEvent(flow.id, null, "lifecycle", `pushing branch ${gitBranch} to origin…`,
          { nodeKey: opts.emitNodeKey });
        try {
          const how = await localGit.pushBranch(lp, gitBranch, flow.repo_url ?? "", authedCloneUrlFor);
          db.emitEvent(flow.id, null, "lifecycle", `branch ${gitBranch} pushed (via ${how === "https" ? "token-authed HTTPS" : "origin remote"})`,
            { nodeKey: opts.emitNodeKey });
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          if (HOOK_PATTERNS.some((p) => p.test(msg))) {
            throw new CommitError(
              `push rejected for branch ${gitBranch}`,
              msg.slice(0, 2000),
            );
          }
          throw e; // network / auth / VPN — manual retry
        }
      }
    }

    const repoUrl = flow.repo_url ?? "";
    const host = gitHostRegistry.forRepo(repoUrl);
    const existing = await host.listChangeRequestsByBranch(repoUrl, gitBranch);
    let cr: ChangeRequest;
    const crTitle = branchName
      ? `${ctx.task.key}: ${ctx.task.summary} (${branchName})`
      : `${ctx.task.key}: ${ctx.task.summary}`;
    if (existing.length) {
      cr = existing[0];
    } else {
      cr = await host.createChangeRequest(repoUrl, {
        sourceBranch: gitBranch,
        targetBranch: ctx.repo?.default_branch ?? "main",
        title: crTitle,
        description: `Implements ${ctx.task.externalUrl}\n\n${ctx.task.summary}${branchName ? `\n\nBranch: ${branchName}` : ""}`,
      });
    }
    const project = await host.getProject(repoUrl);

    if (branchName) {
      // Multi-branch: update the branch row, not the flow row
      branchStore.upsert(flow.id, branchName, {
        mrUrl: cr.webUrl,
        mrIid: cr.number,
        status: "approved",
      });
      // Ensure the host project id is set on the flow (needed by webhook/poller)
      db.run(`UPDATE flows SET gitlab_project_id=COALESCE(gitlab_project_id, ?), updated_at=? WHERE id=?`,
        project.id, db.now(), flow.id);
    } else {
      db.run(
        `UPDATE flows SET mr_url=?, mr_iid=?, gitlab_project_id=?, updated_at=? WHERE id=?`,
        cr.webUrl, cr.number, project.id, db.now(), flow.id
      );
    }
    // The pipeline gate + review re-run fresh for this CR
    for (const key of [NODE_KEYS.PIPELINE, NODE_KEYS.REVIEW] as const) {
      const n = nodeSupport.nodeByKey(flow.id, key);
      if (n.status !== "pending") nodeSupport.setNode(n.id, { status: "pending" });
    }
    db.emitEvent(flow.id, null, "lifecycle", `Change request created: ${cr.webUrl}${branchName ? ` (${branchName})` : ""}`,
      { mrUrl: cr.webUrl, iid: cr.number, branchName: branchName ?? undefined, nodeKey: opts.emitNodeKey });
    return cr;
  }

  /**
   * The service's own bounded retry (pristine plan §2.2): create the CR, and
   * when the push was rejected (pre-push/pre-receive hooks — code rejections)
   * hand the error to the provided fix callback and retry, up to `maxAttempts`
   * fix callbacks. Infra failures (network/auth/API) throw immediately for
   * manual retry. The caller owns what "fix" means (the SDLC chain runs a
   * commit-fix agent on the build step); the service owns the bounded loop.
   */
  async createWithFixes(
    ctx: FlowCtx,
    branchName: string | undefined,
    opts: { maxAttempts: number; runFix: (attempt: number, error: CommitError) => Promise<void>; emitNodeKey?: string },
  ): Promise<ChangeRequest> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.create(ctx, branchName, { emitNodeKey: opts.emitNodeKey });
      } catch (e: unknown) {
        if (!isCommitError(e) || attempt >= opts.maxAttempts) throw e;
        await opts.runFix(attempt + 1, e);
      }
    }
  }
}

export const mergeRequests = new MergeRequestService();
