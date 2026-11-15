import "server-only";

import { db } from "../../../db/app";
import type { ChainRole, FlowCtx } from "../shared/nodeSharedExports";
import { NODE_KEYS } from "../../constants/nodeKeys";
import { EVENT_KIND } from "../../constants/vocabulary";
import { configNumber } from "../../templates/nodeConfig";
import { branchStore } from "../kinds/build/buildExports";
import { mergeRequests, toMrCreationFailure, type CommitError } from "../kinds/mergeRequest/mergeRequestExports";
import type { NodeStatus } from "../../../db/rows";

/** Manual panel/API re-runs after a prior success terminal (done) or debounced wait. */
const MANUAL_CHAIN_STAGE_FROM: readonly NodeStatus[] = ["pending", "failed", "done"];
const MANUAL_RESOLVE_FROM: readonly NodeStatus[] = ["pending", "failed", "done", "waiting"];

/** The engine surface the chain drives — the generic orchestration primitives. */
export interface ChainHost {
  ctx(flowId: string): Promise<FlowCtx>;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string>;
  setCurrentNode(flowId: string, nodeKey: string | null): Promise<void>;
  setNodeStatus(flowId: string, nodeKey: string, status: string): Promise<void>;
  claimNode(flowId: string, nodeKey: string, from: readonly string[]): Promise<string>;
  nodeStatus(flowId: string, nodeKey: string): Promise<string | null>;
  nodeRunning(flowId: string, nodeKey: string): Promise<boolean>;
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  /** the instance key of the flow's node holding a chain role (§T3 —
   *  metadata-routed; the chain names roles, never literal def keys) */
  keyOfRole(flowId: string, role: ChainRole): Promise<string | null>;
  /** the CI gate node (waits on the pipeline source) */
  gateKey(flowId: string): Promise<string | null>;
  /** resolve a node's outgoing edges and start what becomes eligible */
  advanceFrom(flowId: string, fromKey: string): Promise<void>;
  /** true while any post-MR chain stage (pipeline/review/resolve) is running */
  chainBusy(flowId: string): Promise<boolean>;
}

/**
 * The SDLC builtin chain (pristine plan §2.2): the flow actions that drive the
 * builtin loop. The loop's sequencing itself is template data — the seeded
 * `tpl_sdlc_loop` graph expresses gate green → review → debounced resolve →
 * (re-entry) gate — so what remains here is:
 *
 *  - approveBuild: CR creation with the bounded commit-fix retry, then the
 *    template edges take over (build → pipeline → …).
 *  - the Pipeline/Review/Resolve panel entries: run one stage, then advance
 *    the edges exactly like engine auto-starts do.
 *  - the advance interceptor: a builtin-chain module hook the engine consults
 *    so a built-in template's edges can defer to chain-managed stages (the
 *    CR-creation ordering between build approval and the CI gate).
 */
export class SdlcChain {
  constructor(private readonly host: ChainHost) {}

  /**
   * Approve the build output and hand off to the template edges. CR creation
   * (with the bounded commit-fix agent on the build step) runs here — it sits
   * between build approval and the CI gate, so the edges must not start the
   * gate before a CR exists.
   */
  async approveBuild(flowId: string, branchName?: string): Promise<void> {
    const buildKey = await this.host.keyOfRole(flowId, NODE_KEYS.BUILD);
    if (!buildKey) throw new Error("this flow template has no build node");
    const gate = await this.host.gateKey(flowId);
    if (!gate) throw new Error("this flow template has no pipeline gate node");
    const reviewKey = await this.host.keyOfRole(flowId, NODE_KEYS.REVIEW);
    await this.host.setNodeStatus(flowId, buildKey, "approved");
    await this.host.setCurrentNode(flowId, gate);
    this.host.bg(flowId, null, async () => {
      try {
        const maxAttempts = configNumber(
          await this.host.nodeConfigFor(flowId, buildKey), "max_commit_fix_attempts", 2);
        // multi-branch: one CR per awaiting branch; single-branch: the flow-level MR
        const branchTargets = branchName
          ? [branchName]
          : (await branchStore.list(flowId))
              .filter((b) => b.status === "awaiting_approval" || b.status === "approved")
              .map((b) => b.name);
        const targets = branchTargets.length > 1
          ? branchTargets.map((b) => b as string | null)
          : [branchTargets[0] ?? null];
        const multiBranch = targets.length > 1;
        for (const b of targets) {
          await mergeRequests.createWithFixes(await this.host.ctx(flowId), b ?? undefined, {
            maxAttempts,
            emitNodeKey: buildKey,
            gateKey: gate,
            reviewKey,
            skipGateReviewReset: multiBranch,
            runFix: (attempt, error) => this.runBuildCommitFix(flowId, buildKey, gate, b, attempt, maxAttempts, error),
          });
        }
        if (multiBranch) {
          await mergeRequests.resetGateReview(flowId, gate, reviewKey);
        }
        // CR created — the build → pipeline edge starts the gate (and the
        // green gate flows on to review → debounced resolve via edges)
        await this.host.advanceFrom(flowId, buildKey);
      } catch (e: unknown) {
        // CR creation failed (infra, or commit-fix attempts exhausted): hand
        // the step back to the developer — the "Approve & create MR" button
        // reappears and clicking it retries creation with the current state.
        // (Failures inside the edge advance are contained by the stage runner
        // — those nodes carry their own failed status + Retry.)
        const msg = e instanceof Error ? e.message : String(e);
        const mrError = toMrCreationFailure(e);
        await db.emitEvent(flowId, null, EVENT_KIND.MR_FAILED,
                    `MR creation failed: ${mrError.message} — fix the issue, then click "Approve & create MR" again to retry`,
                    { branchName, nodeKey: buildKey, detail: msg !== mrError.message ? msg : undefined });
        await this.host.setNodeStatus(flowId, buildKey, "awaiting_approval");
        await this.host.setCurrentNode(flowId, null);
      }
    });
  }

  /**
   * One commit-fix attempt: run the build node's agent with the push-rejection
   * feedback so it fixes the code and re-pushes to the same branch.
   */
  private async runBuildCommitFix(
    flowId: string,
    buildKey: string,
    gate: string,
    branch: string | null,
    attempt: number,
    maxAttempts: number,
    error: CommitError,
  ): Promise<void> {
    await db.emitEvent(flowId, null, EVENT_KIND.LIFECYCLE,
            `push rejected — running a commit-fix agent on the build step (attempt ${attempt}/${maxAttempts})`,
            { nodeKey: buildKey });
    await this.host.setCurrentNode(flowId, buildKey);
    await this.host.claimNode(flowId, buildKey, ["approved"]);
    try {
      const branchRow = branch ? (await branchStore.list(flowId)).find((r) => r.name === branch) : null;
      await this.host.runNode(flowId, buildKey, {
        plan: null,
        prompt: null,
        branchInfo: branch
          ? { name: branch, title: branchRow?.title ?? branch }
          : null,
        model: null,
        feedback:
          `Pushing branch was rejected with the error below — most likely a pre-push/pre-receive hook ` +
          `(type check, lint, or test gate). Fix the code so the checks pass, commit, and push again to the same branch.\n\n` +
          `${error.detail}`,
      });
    } finally {
      await this.host.setNodeStatus(flowId, buildKey, "approved");
      await this.host.setCurrentNode(flowId, gate);
    }
  }

  /** (Re)run the pipeline gate — from the Pipeline panel, poller, or webhook. */
  async triggerPipelineGate(flowId: string, pipelineId?: number, model?: string): Promise<void> {
    if (await this.host.chainBusy(flowId)) return;
    const gate = await this.host.gateKey(flowId);
    if (!gate) throw new Error("this flow template has no pipeline gate node");
    await this.host.claimNode(flowId, gate, MANUAL_CHAIN_STAGE_FROM);
    await this.host.setCurrentNode(flowId, gate);
    this.host.bg(flowId, gate, async () => {
      await this.host.runNode(flowId, gate, {
        branchName: null, pipelineId: pipelineId ?? null, guidance: null, model: model ?? null,
      });
      await this.host.advanceFrom(flowId, gate);
    });
  }

  /** Manual resolve run (Run button / API): run the stage, then the edges. */
  async triggerResolve(flowId: string, model?: string): Promise<void> {
    const resolveKey = await this.host.keyOfRole(flowId, NODE_KEYS.RESOLVE);
    if (!resolveKey) return;
    if (await this.host.nodeRunning(flowId, resolveKey)) return;
    // Direct triggers respect the chain — resolve must not run while the
    // pipeline/review/resolve chain is in flight.
    if (await this.host.chainBusy(flowId)) {
      throw new Error("wait for the pipeline/review step to finish before running resolve");
    }
    await this.host.claimNode(flowId, resolveKey, MANUAL_RESOLVE_FROM);
    await this.host.setCurrentNode(flowId, resolveKey);
    this.host.bg(flowId, resolveKey, async () => {
      await this.host.runNode(flowId, resolveKey, {
        instructions: null, branchName: null, model: model ?? null,
      });
      await this.host.advanceFrom(flowId, resolveKey);
    });
  }

  /** Manual review run (Run button / API): run the stage, then the edges. */
  async triggerReview(flowId: string, model?: string): Promise<void> {
    const reviewKey = await this.host.keyOfRole(flowId, NODE_KEYS.REVIEW);
    if (!reviewKey) throw new Error("this flow template has no review node");
    if (await this.host.chainBusy(flowId)) throw new Error("wait for the current pipeline/review/resolve run to finish first");
    await this.host.claimNode(flowId, reviewKey, MANUAL_CHAIN_STAGE_FROM);
    await this.host.setCurrentNode(flowId, reviewKey);
    this.host.bg(flowId, reviewKey, async () => {
      await this.host.runNode(flowId, reviewKey, {
        instructions: null, branchName: null, model: model ?? null,
      });
      await this.host.advanceFrom(flowId, reviewKey);
    });
  }
}

export function createSdlcChain(host: ChainHost): SdlcChain {
  return new SdlcChain(host);
}
