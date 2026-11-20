import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "../../../../../db/app";
import { localGit } from "../../../../../git/local";
import { gitHostRegistry, gitRemoteContextFor, type ChangeRequest } from "../../../../ports/gitHost";
import { flowCtxHelper } from "../../../shared/runContext";
import type { FlowCtx } from "../../../shared/runContext/types/flowContext";
import { nodeSupport } from "@/lib/composition/container";
import { branchStore } from "../../build/branchStore";
import { CommitError } from "../errors";
import { isCommitError } from "../utils/isCommitError";
import { isHookRejection } from "../utils/isHookRejection";

/**
 * Create (or reuse) the git-host change request (MR/PR) for a built branch,
 * then reset the pipeline + review nodes to pending. Shared by single- and
 * multi-branch flows.
 *
 * This is an operation on the graph rather than a node itself — it sits
 * between build approval and the pipeline gate.
 */
export class MergeRequestService {
  /** Reset gate + review to pending once all branch MRs exist — skip `running`.
   *  The reset itself is the declared `gateReset` transition (from-set fenced:
   *  a running or already-pending node is never touched). */
  async resetGateReview(
    flowId: string,
    gateKey: string | null,
    reviewKey: string | null,
  ): Promise<void> {
    for (const key of [gateKey, reviewKey]) {
      if (!key) continue;
      const n = await nodeSupport.optionalNodeByKey(flowId, key);
      if (!n || n.status === "running" || n.status === "pending") continue;
      await nodeSupport.applyTransition(flowId, key, "gateReset");
    }
  }

  async create(
    ctx: FlowCtx,
    branchName?: string,
    opts: {
      emitNodeKey?: string;
      gateKey?: string | null;
      reviewKey?: string | null;
      skipGateReviewReset?: boolean;
      /**
       * Completion hook (step 06 task 5, Invariant 7): runs in the SAME
       * transaction as the MR rows' persist (branch/flow update), so a crash
       * cannot leave a persisted MR with a still-claimed journal job. The
       * gate reset + lifecycle event stay OUTSIDE (transitions announce
       * outside transactions; no host I/O ever runs inside).
       */
      onPersist?: (tx: Prisma.TransactionClient) => Promise<void>;
    } = {},
  ): Promise<ChangeRequest> {
    const flow = ctx.flow;
    const gitBranch = branchName
      ? ((await branchStore.gitBranch(flow.id, branchName)) ?? flowCtxHelper.buildBranch(ctx, branchName))
      : flow.mrBranch;
    if (!gitBranch) throw new Error("no build branch to create an MR from");

    // Local mode: the branch may exist only in the local checkout (the agent
    // commits locally; a restart may have killed the run before it pushed).
    if (flowCtxHelper.execMode(ctx) === "local") {
      const lp = flowCtxHelper.localPath(ctx);
      if (lp) {
        await db.emitEvent(flow.id, null, "lifecycle", `pushing branch ${gitBranch} to origin…`,
                    { nodeKey: opts.emitNodeKey });
        try {
          const how = await localGit.pushBranch(lp, gitBranch, flow.repoUrl ?? "", gitRemoteContextFor);
          await db.emitEvent(flow.id, null, "lifecycle", `branch ${gitBranch} pushed (via ${how === "https" ? "token-authed HTTPS" : "origin remote"})`,
                        { nodeKey: opts.emitNodeKey });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (isHookRejection(msg)) {
            throw new CommitError(
              `push rejected for branch ${gitBranch}`,
              msg.slice(0, 2000),
            );
          }
          throw e instanceof Error ? e : new Error(msg); // network / auth / VPN — manual retry
        }
      }
    }

    const repoUrl = flow.repoUrl ?? "";
    const host = await gitHostRegistry.forRepo(repoUrl);
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
        targetBranch: ctx.repo?.defaultBranch ?? "main",
        title: crTitle,
        description: `Implements ${ctx.task.externalUrl}\n\n${ctx.task.summary}${branchName ? `\n\nBranch: ${branchName}` : ""}`,
      });
    }
    const project = await host.getProject(repoUrl);

    // The DB-write tail — the MR rows and the flows row' gitlabProjectId —
    // and the caller's completion hook land in ONE transaction (step 06 task
    // 5): a crash cannot split the MR's persistence from the journal job's
    // completion. The host I/O above stays outside.
    await db.transaction(async (tx) => {
      if (branchName) {
        // Multi-branch: update the branch row, not the flow row
        await branchStore.upsert(flow.id, branchName, {
          mrUrl: cr.webUrl,
          mrIid: cr.number,
          status: "approved",
        }, tx);
        // Ensure the host project id is set on the flow (needed by webhook/poller)
        await tx.flow.updateMany({
          where: { id: flow.id, gitlabProjectId: null },
          data: { gitlabProjectId: project.id, updatedAt: new Date() },
        });
      } else {
        await tx.flow.update({
          where: { id: flow.id },
          data: { mrUrl: cr.webUrl, mrIid: cr.number, gitlabProjectId: project.id, updatedAt: new Date() },
        });
      }
      await opts.onPersist?.(tx);
    });
    if (!opts.skipGateReviewReset) {
      await this.resetGateReview(flow.id, opts.gateKey ?? null, opts.reviewKey ?? null);
    }
    await db.emitEvent(flow.id, null, "lifecycle", `Change request created: ${cr.webUrl}${branchName ? ` (${branchName})` : ""}`,
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
    opts: {
      maxAttempts: number;
      runFix: (attempt: number, error: CommitError) => Promise<void>;
      emitNodeKey?: string;
      gateKey?: string | null;
      reviewKey?: string | null;
      skipGateReviewReset?: boolean;
      onPersist?: (tx: Prisma.TransactionClient) => Promise<void>;
    },
  ): Promise<ChangeRequest> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.create(ctx, branchName, {
          emitNodeKey: opts.emitNodeKey,
          gateKey: opts.gateKey,
          reviewKey: opts.reviewKey,
          skipGateReviewReset: opts.skipGateReviewReset,
          onPersist: opts.onPersist,
        });
      } catch (e: unknown) {
        if (!isCommitError(e) || attempt >= opts.maxAttempts) throw e;
        await opts.runFix(attempt + 1, e);
      }
    }
  }
}
