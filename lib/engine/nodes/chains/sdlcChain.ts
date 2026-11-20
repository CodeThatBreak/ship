import "server-only";

import { NODE_KEYS } from "../../constants/nodeKeys";
import { NotFoundError } from "../../../errors";
import { TRIGGER_SOURCE } from "../../runtime/triggers/constants/triggerSources";
import { configNumber } from "../../templates/nodeConfig";
import { branchStore } from "../kinds/build/buildExports";
import { mergeRequests, type CommitError } from "../kinds/mergeRequest/mergeRequestExports";
import { JobQueue } from "../../runtime/jobs/jobQueue";
import { MrCreateHandler } from "../../runtime/jobs/mrCreateHandler";
import { JOB_KIND } from "../../runtime/jobs/constants/jobVocabulary";
import { mrCreateDedupKey } from "../../runtime/jobs/utils/jobDedupKeys";
import type { ChangeRequest } from "../../ports/gitHost";
import { NODE_STATUS } from "../../constants/nodeStatus";
import { EFFECT_LIFECYCLE } from "../../runtime/effects/constants/effectLifecycles";
import type { TriggerResult, TriggerSource } from "../../runtime/triggers/types/triggerGateway";
import type { ChainHost } from "./types/chainHost";

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
   * Approve the build output. The MR-create sequencing is NOT here — it is
   * the build's declared `afterApproval` effect (registered by `sdlcEffects`,
   * dispatched through the effect registry on this won approve): the
   * CR-before-gate ordering is registry data, not call ordering.
   */
  async approveBuild(flowId: string, branchName?: string): Promise<TriggerResult> {
    const buildKey = await this.host.keyOfRole(flowId, NODE_KEYS.BUILD);
    if (!buildKey) throw new Error("this flow template has no build node");
    const gate = await this.host.gateKey(flowId);
    if (!gate) throw new Error("this flow template has no pipeline gate node");
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
    // the won approve fires the registered afterApproval effect — the
    // MR-create sequence + the deferred edge advance (CR-before-gate)
    await this.host.runEffect(EFFECT_LIFECYCLE.AFTER_APPROVAL, {
      flowId,
      nodeKey: buildKey,
      defKey: NODE_KEYS.BUILD,
      status: NODE_STATUS.APPROVED,
      output: null,
      source: TRIGGER_SOURCE.UI,
      params: { branchName },
    });
    return approved;
  }

  /**
   * The build `afterApproval` effect implementation (registered by
   * `sdlcEffects`): CR creation with the bounded commit-fix agent on the
   * build step. It sits between build approval and the CI gate, so the edges
   * must not start the gate before a CR exists — the advance past the build
   * happens here, only when every branch target's creation landed.
   */
  async mrCreateSequence(flowId: string, buildKey: string, branchName?: string): Promise<void> {
    this.host.bg(flowId, null, async () => {
      const gate = await this.host.gateKey(flowId);
      if (!gate) throw new Error("this flow template has no pipeline gate node");
      const reviewKey = await this.host.keyOfRole(flowId, NODE_KEYS.REVIEW);
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
      // step 06 task 5 (Invariant 7): the MR-creation sequence is journaled
      // write-ahead — one `mr_create` job per branch target, claimed and
      // dispatched inline through the same handler the worker sweep's
      // re-claim runs. A crash between the approval and the persisted MR
      // leaves the job for the sweep (the adopt path picks the MR up).
      const jobs = new JobQueue();
      const outcomes: (ChangeRequest | null)[] = [];
      for (const b of targets) {
        outcomes.push(await this.dispatchJournaledMrCreate(
          flowId, buildKey, gate, reviewKey, b, multiBranch, maxAttempts, jobs,
        ));
      }
      // any deferred/failed target blocks the advance — a recorded failure
      // handed the build back (the button reappears), a live intent still
      // owns its creation; the retrying job's terminal fail reverts via the
      // reconciler's approved-no-MR branch
      if (outcomes.some((o) => o == null)) return;
      if (multiBranch) {
        await mergeRequests.resetGateReview(flowId, gate, reviewKey);
      }
      // CR created — the build → pipeline edge starts the gate (and the
      // green gate flows on to review → debounced resolve via edges)
      await this.host.advanceFrom(flowId, buildKey);
    });
  }

  /**
   * One branch target's journaled MR creation (step 06 task 5): enqueue the
   * `mr_create` job write-ahead, claim it, dispatch the MrCreateHandler
   * inline with this chain's commit-fix run wired in. Returns null when the
   * target's creation is deferred to a live intent or ended in a recorded
   * failure — the caller must not advance past the build.
   */
  private async dispatchJournaledMrCreate(
    flowId: string,
    buildKey: string,
    gate: string,
    reviewKey: string | null,
    branch: string | null,
    skipGateReviewReset: boolean,
    maxAttempts: number,
    jobs: JobQueue,
  ): Promise<ChangeRequest | null> {
    const { id: jobId, deduplicated } = await jobs.enqueue({
      kind: JOB_KIND.MR_CREATE,
      flowId,
      dedupKey: mrCreateDedupKey(flowId, branch ?? undefined),
      payload: {
        flowId,
        branchName: branch ?? undefined,
        emitNodeKey: buildKey,
        gateKey: gate,
        reviewKey,
        skipGateReviewReset,
        maxCommitFixAttempts: maxAttempts,
      },
    });
    if (deduplicated) return null; // a live intent owns this branch's MR
    const job = await jobs.claimById(jobId);
    if (!job) return null; // the worker sweep owns the dispatch
    try {
      return await new MrCreateHandler(jobs, (t, attempt, error) =>
        this.runBuildCommitFix(t.flowId, t.buildKey, t.branch, attempt, t.maxAttempts, error),
      ).handle(job);
    } catch (e: unknown) {
      // infra failure — requeue with backoff; the sweep's re-claim (or the
      // developer's re-approve once the budget terminal-fails) owns the retry
      await jobs.fail(jobId, e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /**
   * One commit-fix attempt: run the build node's agent with the push-rejection
   * feedback so it fixes the code and re-pushes to the same branch. Public
   * since step 06 task 5 — the mr_create journal's re-claim path dispatches
   * it through `flowEngine.chain.runBuildCommitFix` (the poller's handler wiring).
   */
  async runBuildCommitFix(
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
      await this.host.postTerminal(flowId, gate);
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
      await this.host.postTerminal(flowId, resolveKey);
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
      await this.host.postTerminal(flowId, reviewKey);
    });
    return result;
  }
}

