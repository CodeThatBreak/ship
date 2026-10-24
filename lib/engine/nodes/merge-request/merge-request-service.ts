import { db } from "../../../db";
import { localGit } from "../../../git/local";
import { gitLab, type MergeRequest } from "../../../integrations/gitlab";
import { flowCtxHelper, nodeSupport, type FlowCtx } from "../base";
import { branchStore } from "../build";
import { NODE_KEYS } from "../keys";

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
 * Create (or reuse) the GitLab merge request for a built branch, then reset
 * the pipeline + review nodes to pending. Shared by single- and multi-branch
 * flows.
 *
 * This is an operation on the graph rather than a node itself — it sits
 * between build approval and the pipeline gate.
 */
export class MergeRequestService {
  async create(ctx: FlowCtx, branchName?: string): Promise<MergeRequest> {
    const flow = ctx.flow;
    const gitBranch = branchName ? flowCtxHelper.buildBranch(ctx, branchName) : flow.mr_branch;
    if (!gitBranch) throw new Error("no build branch to create an MR from");

    // Local mode: the branch may exist only in the local checkout (the agent
    // commits locally; a restart may have killed the run before it pushed).
    if (flowCtxHelper.execMode(ctx) === "local") {
      const lp = flowCtxHelper.localPath(ctx);
      if (lp) {
        db.emitEvent(flow.id, null, "lifecycle", `pushing branch ${gitBranch} to origin…`);
        try {
          const how = await localGit.pushBranch(lp, gitBranch, flow.repo_url ?? "");
          db.emitEvent(flow.id, null, "lifecycle", `branch ${gitBranch} pushed (via ${how === "https" ? "token-authed HTTPS" : "origin remote"})`);
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
    const existing = await gitLab.listMRsByBranch(repoUrl, gitBranch);
    let mr: MergeRequest;
    const mrTitle = branchName
      ? `${ctx.task.key}: ${ctx.task.summary} (${branchName})`
      : `${ctx.task.key}: ${ctx.task.summary}`;
    if (existing.length) {
      mr = existing[0];
    } else {
      mr = await gitLab.createMR(repoUrl, {
        source_branch: gitBranch,
        target_branch: ctx.repo?.default_branch ?? "main",
        title: mrTitle,
        description: `Implements ${ctx.task.jiraUrl}\n\n${ctx.task.summary}${branchName ? `\n\nBranch: ${branchName}` : ""}`,
      });
    }
    const project = await gitLab.getProject(repoUrl);

    if (branchName) {
      // Multi-branch: update the branch row, not the flow row
      branchStore.upsert(flow.id, branchName, {
        mrUrl: mr.web_url,
        mrIid: mr.iid,
        status: "approved",
      });
      // Ensure gitlab_project_id is set on the flow (needed by webhook/poller)
      db.run(`UPDATE flows SET gitlab_project_id=COALESCE(gitlab_project_id, ?), updated_at=? WHERE id=?`,
        project.id, db.now(), flow.id);
    } else {
      db.run(
        `UPDATE flows SET mr_url=?, mr_iid=?, gitlab_project_id=?, updated_at=? WHERE id=?`,
        mr.web_url, mr.iid, project.id, db.now(), flow.id
      );
    }
    // The pipeline gate + review re-run fresh for this MR
    for (const key of [NODE_KEYS.PIPELINE, NODE_KEYS.REVIEW] as const) {
      const n = nodeSupport.nodeByKey(flow.id, key);
      if (n.status !== "pending") nodeSupport.setNode(n.id, { status: "pending" });
    }
    db.emitEvent(flow.id, null, "lifecycle", `Merge request created: ${mr.web_url}${branchName ? ` (${branchName})` : ""}`,
      { mrUrl: mr.web_url, iid: mr.iid, branchName: branchName ?? undefined });
    return mr;
  }
}

export const mergeRequests = new MergeRequestService();
