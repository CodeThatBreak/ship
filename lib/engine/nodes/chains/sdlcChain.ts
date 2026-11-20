import "server-only";

import type { ChainRole, FlowCtx } from "../shared/nodeSharedExports";
import { NODE_KEYS } from "../../constants/nodeKeys";
import { NotFoundError } from "../../../errors";
import { TRIGGER_SOURCE } from "../../runtime/triggers/constants/triggerSources";
import { configNumber } from "../../templates/nodeConfig";
import { branchStore } from "../kinds/build/buildExports";
import { mergeRequests, toMrCreationFailure, type CommitError } from "../kinds/mergeRequest/mergeRequestExports";
import type { EngineNodeStatus } from "../../constants/nodeStatus";
import type { TransitionKey } from "../../runtime/transitions/types/transitions";
import type { TriggerResult, TriggerSource } from "../../runtime/triggers/types/triggerGateway";

/** The engine surface the chain drives — the generic orchestration primitives. */
export interface ChainHost {
  ctx(flowId: string): Promise<FlowCtx>;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string>;
  /** keyed delegate to the transition authority (declared from→to set) */
  setNodeStatus(flowId: string, nodeKey: string, key: TransitionKey, opts?: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string }): Promise<boolean>;
  claimNode(flowId: string, nodeKey: string, key: TransitionKey): Promise<string>;
  nodeStatus(flowId: string, nodeKey: string): Promise<string | null>;
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  emitLifecycle(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void>;
  emitMrFailed(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void>;
  /** the instance key of the flow's node holding a chain role (§T3 —
   *  metadata-routed; the chain names roles, never literal def keys) */
  keyOfRole(flowId: string, role: ChainRole): Promise<string | null>;
  /** the CI gate node (waits on the pipeline source) */
  gateKey(flowId: string): Promise<string | null>;
  /** resolve a node's outgoing edges and start what becomes eligible */
  advanceFrom(flowId: string, fromKey: string): Promise<void>;
  /** the instance keys of the flow's post-MR chain stages (the claim
   *  guard's in-flight set — step 06 folds the old chainBusy read into the
   *  claim UPDATE itself) */
  chainKeys(flowId: string): Promise<string[]>;
  /** the TriggerGateway doors (step 06): every trigger claims here — a lost
   *  claim emits the typed skip event and returns the skipped result */
  claimTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
    chainKeys?: readonly string[];
  }): Promise<TriggerResult>;
  transitionTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
  }): Promise<TriggerResult>;
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
 *
 * Every status write is a declared transition through the authority (step 02):
 * `buildApprove` (awaiting → approved), `commitFix` (approved → running),
 * `commitFixHandback` (running/awaiting → approved — the old unconditional
 * `finally` overwrite is gone: a genuinely failed fix run stands failed), and
 * `mrHandback` (approved → awaiting when MR creation failed). The manual
 * stage/resolve claims (`manualStage`, `manualResolve`) carry their from-sets
 * in the transition table, not here.
 */
export class SdlcChain {
  constructor(private readonly host: ChainHost) {}

  /**
   * Approve the build output and hand off to the template edges. CR creation
   * (with the bounded commit-fix agent on the build step) runs here — it sits
   * between build approval and the CI gate, so the edges must not start the
   * gate before a CR exists.
   */
  async approveBuild(flowId: string, branchName?: string): Promise<TriggerResult> {
    const buildKey = await this.host.keyOfRole(flowId, NODE_KEYS.BUILD);
    if (!buildKey) throw new Error("this flow template has no build node");
    const gate = await this.host.gateKey(flowId);
    if (!gate) throw new Error("this flow template has no pipeline gate node");
    const reviewKey = await this.host.keyOfRole(flowId, NODE_KEYS.REVIEW);
    // declared approval: awaiting_approval → approved (the button's contract)
    // — claimed through the gateway (step 06): a node not in the from-set
    // loses here with the typed skip event instead of the ad-hoc throw
    const approved = await this.host.transitionTrigger({
      flowId,
      nodeKey: buildKey,
      source: TRIGGER_SOURCE.UI,
      key: "buildApprove",
    });
    if (!approved.started) return approved;
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
            runFix: (attempt, error) => this.runBuildCommitFix(flowId, buildKey, b, attempt, maxAttempts, error),
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
        await this.host.emitMrFailed(flowId, buildKey,
                    `MR creation failed: ${mrError.message} — fix the issue, then click "Approve & create MR" again to retry`,
                    { branchName, nodeKey: buildKey, detail: msg !== mrError.message ? msg : undefined });
        // declared hand-back: approved → awaiting_approval. A node the fix
        // loop left in another state (e.g. failed) keeps that state — the
        // failure stands visible for retry.
        await this.host.setNodeStatus(flowId, buildKey, "mrHandback");
      }
    });
    return approved;
  }

  /**
   * One commit-fix attempt: run the build node's agent with the push-rejection
   * feedback so it fixes the code and re-pushes to the same branch.
   */
  private async runBuildCommitFix(
    flowId: string,
    buildKey: string,
    branch: string | null,
    attempt: number,
    maxAttempts: number,
    error: CommitError,
  ): Promise<void> {
    await this.host.emitLifecycle(flowId, buildKey,
            `push rejected — running a commit-fix agent on the build step (attempt ${attempt}/${maxAttempts})`,
            { nodeKey: buildKey });
    // declared effect claim: approved → running (fresh attempt token)
    await this.host.claimNode(flowId, buildKey, "commitFix");
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
      // declared hand-back so the bounded loop can re-claim from approved.
      // From-set fenced (running / awaiting_approval): a genuinely failed
      // fix run — or any terminal the run published outside those — is left
      // untouched; the old unconditional "back to approved" hid real
      // outcomes (step-02 risk item, covered by the characterization tests).
      await this.host.setNodeStatus(flowId, buildKey, "commitFixHandback");
    }
  }

  /**
   * (Re)run the pipeline gate — from the Pipeline panel, poller, or webhook.
   * The claim (manualStage from-set + the chain in-flight guard in the same
   * conditional UPDATE) is the duplicate fence: the loser emits the typed
   * `skipped_duplicate_trigger` event and the caller's route answers 409 —
   * the old silent `chainBusy` return is gone (step 06).
   */
  async triggerPipelineGate(
    flowId: string,
    pipelineId?: number,
    model?: string,
    source: TriggerSource = TRIGGER_SOURCE.UI,
  ): Promise<TriggerResult> {
    const gate = await this.host.gateKey(flowId);
    if (!gate) throw new Error("this flow template has no pipeline gate node");
    const result = await this.host.claimTrigger({
      flowId,
      nodeKey: gate,
      source,
      key: "manualStage",
      chainKeys: await this.host.chainKeys(flowId),
    });
    if (!result.started) return result;
    this.host.bg(flowId, gate, async () => {
      await this.host.runNode(flowId, gate, {
        branchName: null, pipelineId: pipelineId ?? null, guidance: null, model: model ?? null,
      });
      await this.host.advanceFrom(flowId, gate);
    });
    return result;
  }

  /**
   * Manual resolve run (Run button / API): run the stage, then the edges.
   * The claim (manualResolve from-set + chain guard) covers both old guards
   * — the `nodeRunning` silent return and the `chainBusy` throw are gone
   * (step 06): a busy chain or an in-flight resolve loses the claim and
   * emits the skip event.
   */
  async triggerResolve(flowId: string, model?: string, source: TriggerSource = TRIGGER_SOURCE.UI): Promise<TriggerResult> {
    const resolveKey = await this.host.keyOfRole(flowId, NODE_KEYS.RESOLVE);
    if (!resolveKey) throw new NotFoundError("node", "resolve");
    const result = await this.host.claimTrigger({
      flowId,
      nodeKey: resolveKey,
      source,
      key: "manualResolve",
      chainKeys: await this.host.chainKeys(flowId),
    });
    if (!result.started) return result;
    this.host.bg(flowId, resolveKey, async () => {
      await this.host.runNode(flowId, resolveKey, {
        instructions: null, branchName: null, model: model ?? null,
      });
      await this.host.advanceFrom(flowId, resolveKey);
    });
    return result;
  }

  /**
   * Manual review run (Run button / API): run the stage, then the edges.
   * The claim (manualStage from-set + chain guard) replaces the `chainBusy`
   * throw (step 06) — a busy chain loses the claim and emits the skip event.
   */
  async triggerReview(flowId: string, model?: string, source: TriggerSource = TRIGGER_SOURCE.UI): Promise<TriggerResult> {
    const reviewKey = await this.host.keyOfRole(flowId, NODE_KEYS.REVIEW);
    if (!reviewKey) throw new Error("this flow template has no review node");
    const result = await this.host.claimTrigger({
      flowId,
      nodeKey: reviewKey,
      source,
      key: "manualStage",
      chainKeys: await this.host.chainKeys(flowId),
    });
    if (!result.started) return result;
    this.host.bg(flowId, reviewKey, async () => {
      await this.host.runNode(flowId, reviewKey, {
        instructions: null, branchName: null, model: model ?? null,
      });
      await this.host.advanceFrom(flowId, reviewKey);
    });
    return result;
  }
}

export function createSdlcChain(host: ChainHost): SdlcChain {
  return new SdlcChain(host);
}
