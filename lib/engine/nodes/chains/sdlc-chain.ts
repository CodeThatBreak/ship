import "server-only";

import { db } from "../../../db";
import type { ChainRole, FlowCtx } from "../shared";
import { NODE_KEYS } from "../../constants/node-keys";
import { configNumber } from "../../templates/node-config";
import { branchStore } from "../kinds/build";
import { mergeRequests, type CommitError } from "../kinds/merge-request";

/** The engine surface the chain drives — the generic orchestration primitives. */
export interface ChainHost {
  ctx(flowId: string): FlowCtx;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string>;
  setCurrentNode(flowId: string, nodeKey: string | null): void;
  setNodeStatus(flowId: string, nodeKey: string, status: string): void;
  nodeStatus(flowId: string, nodeKey: string): string;
  nodeRunning(flowId: string, nodeKey: string): boolean;
  nodeConfigFor(flowId: string, nodeKey: string): Record<string, unknown>;
  /** the instance key of the flow's node holding a chain role (§T3 —
   *  metadata-routed; the chain names roles, never literal def keys) */
  keyOfRole(flowId: string, role: ChainRole): string | null;
  /** the CI gate node (waits on the pipeline source) */
  gateKey(flowId: string): string | null;
  /** resolve a node's outgoing edges and start what becomes eligible */
  advanceFrom(flowId: string, fromKey: string): Promise<void>;
  /** true while any post-MR chain stage (pipeline/review/resolve) is running */
  chainBusy(flowId: string): boolean;
}

/** Distinguishes MR-creation failures from later pipeline/review failures. */
export class MrCreationFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MrCreationFailed";
  }
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
  approveBuild(flowId: string, branchName?: string): void {
    const buildKey = this.host.keyOfRole(flowId, NODE_KEYS.BUILD);
    if (!buildKey) throw new Error("this flow template has no build node");
    const gate = this.host.gateKey(flowId);
    if (!gate) throw new Error("this flow template has no pipeline gate node");
    this.host.setNodeStatus(flowId, buildKey, "approved");
    this.host.setCurrentNode(flowId, gate);
    this.host.bg(flowId, null, async () => {
      try {
        const maxAttempts = configNumber(
          this.host.nodeConfigFor(flowId, buildKey), "max_commit_fix_attempts", 2);
        // multi-branch: one CR per awaiting branch; single-branch: the flow-level MR
        const branchTargets = branchName
          ? [branchName]
          : branchStore.list(flowId)
              .filter((b) => b.status === "awaiting_approval" || b.status === "approved")
              .map((b) => b.name);
        const targets = branchTargets.length > 1
          ? branchTargets.map((b) => b as string | null)
          : [branchTargets[0] ?? null];
        for (const b of targets) {
          await mergeRequests.createWithFixes(this.host.ctx(flowId), b ?? undefined, {
            maxAttempts,
            // the CR-creation events route to the owning build tab (§3.3)
            emitNodeKey: buildKey,
            runFix: (attempt, error) => this.runBuildCommitFix(flowId, buildKey, gate, b, attempt, maxAttempts, error),
          });
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
        const mrError = e instanceof MrCreationFailed ? e : new MrCreationFailed(msg);
        db.emitEvent(flowId, null, "mr_failed",
          `MR creation failed: ${mrError.message} — fix the issue, then click "Approve & create MR" again to retry`,
          { branchName, nodeKey: buildKey });
        this.host.setNodeStatus(flowId, buildKey, "awaiting_approval");
        this.host.setCurrentNode(flowId, null);
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
    db.emitEvent(flowId, null, "lifecycle",
      `push rejected — running a commit-fix agent on the build step (attempt ${attempt}/${maxAttempts})`,
      { nodeKey: buildKey });
    this.host.setCurrentNode(flowId, buildKey);
    this.host.setNodeStatus(flowId, buildKey, "running");
    try {
      await this.host.runNode(flowId, buildKey, {
        plan: null, prompt: null, branchInfo: null, model: null,
        feedback:
          `Pushing branch was rejected with the error below — most likely a pre-push/pre-receive hook ` +
          `(type check, lint, or test gate). Fix the code so the checks pass, commit, and push again to the same branch.\n\n` +
          `${error.detail}`,
      });
    } finally {
      this.host.setNodeStatus(flowId, buildKey, "approved");
      // hand the pointer back to the gate the chain will enter next
      this.host.setCurrentNode(flowId, gate);
    }
  }

  /** (Re)run the pipeline gate — from the Pipeline panel, poller, or webhook. */
  triggerPipelineGate(flowId: string, pipelineId?: number, prompt?: string, model?: string, promptIsBody?: boolean): void {
    if (this.host.chainBusy(flowId)) return;
    const gate = this.host.gateKey(flowId);
    if (!gate) throw new Error("this flow template has no pipeline gate node");
    this.host.setCurrentNode(flowId, gate);
    this.host.bg(flowId, gate, async () => {
      try {
        // a green gate advances the template edges — review (and the
        // debounced resolve when comments arrive) flows via edges
        await this.host.runNode(flowId, gate, {
          branchName: null, pipelineId: pipelineId ?? null, guidance: null,
          prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, model: model ?? null,
        });
        await this.host.advanceFrom(flowId, gate);
      } finally {
        this.host.setCurrentNode(flowId, null);
      }
    });
  }

  /** Manual resolve run (Run button / API): run the stage, then the edges. */
  triggerResolve(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean): void {
    const resolveKey = this.host.keyOfRole(flowId, NODE_KEYS.RESOLVE);
    if (!resolveKey) return;
    if (this.host.nodeRunning(flowId, resolveKey)) return;
    // Direct triggers respect the chain — resolve must not run while the
    // pipeline/review/resolve chain is in flight.
    if (this.host.chainBusy(flowId)) {
      throw new Error("wait for the pipeline/review step to finish before running resolve");
    }
    this.host.setCurrentNode(flowId, resolveKey);
    this.host.bg(flowId, resolveKey, async () => {
      try {
        await this.host.runNode(flowId, resolveKey, {
          instructions: null, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, branchName: null, model: model ?? null,
        });
        // the resolve → re-gate loop edge (condition = resolve changed code)
        // activates here exactly like an engine auto-start's edges do
        await this.host.advanceFrom(flowId, resolveKey);
      } finally {
        this.host.setCurrentNode(flowId, null);
      }
    });
  }

  /** Manual review run (Run button / API): run the stage, then the edges. */
  triggerReview(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean): void {
    const reviewKey = this.host.keyOfRole(flowId, NODE_KEYS.REVIEW);
    if (!reviewKey) throw new Error("this flow template has no review node");
    if (this.host.chainBusy(flowId)) throw new Error("wait for the current pipeline/review/resolve run to finish first");
    this.host.setCurrentNode(flowId, reviewKey);
    this.host.bg(flowId, reviewKey, async () => {
      try {
        await this.host.runNode(flowId, reviewKey, {
          instructions: null, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, branchName: null, model: model ?? null,
        });
        // the review → resolve edge arms the debounced resolve when comments
        // are open — the same contract as an engine auto-start
        await this.host.advanceFrom(flowId, reviewKey);
      } finally {
        this.host.setCurrentNode(flowId, null);
      }
    });
  }
}

export function createSdlcChain(host: ChainHost): SdlcChain {
  return new SdlcChain(host);
}
