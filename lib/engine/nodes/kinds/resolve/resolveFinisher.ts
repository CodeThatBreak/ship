import "server-only";

/**
 * `ResolveFinisher` — the finalize/recovery half of the resolve kind (engine
 * overhaul step 05, task 8): everything that happens after the agent's run
 * returns, extracted from `ResolveNode` so the def keeps orchestration only.
 *
 * Role in the mental model: the def starts the agent and hands the result
 * here; the finisher owns the §6 pipeline — the contract parse through the
 * ONE `AgentOutputPipeline` (with the def's bounded feedback retry), the
 * push-state verification (§6A), the engine push for unpushed local commits,
 * the ledger-persisted host effects (`ResolveEffects`), and the outcome
 * construction. Restart recovery re-enters the same pipeline (`restart:
 * true`, no baseline) via `recoverOutcome`.
 *
 * Invariants upheld:
 *  - never close a thread on unverifiable facts — an unreadable MR head is
 *    `unknown` with a loud error event (§6A/G6), and local-only commits are
 *    pushed before any thread closes;
 *  - the idempotency ledger rides the artifact meta after every landed effect
 *    (§4), so restart recovery skips what the host already has (G10);
 *  - an UNPARSEABLE recovery meta THROWS — mapping it to an empty ledger
 *    would re-apply every effect; the def's `recover` maps the throw to
 *    `{ kind: "manual" }`.
 *
 * Must never: start a run of its own (only the contract-retry and hook-fix
 * follow-up turns on the existing session), mutate node status or publish
 * outcomes (that stays with the def's `applyOutcome`), or trust the agent's
 * self-report for the push state — only host-verified facts count (§6A).
 */
import { localGit } from "../../../../git/local";
import {
  gitRemoteContextFor,
  type GitHostResolver,
} from "../../../ports/gitHost";
import type { AgentRunResult } from "../../../ports/agentPort";
import {
  flowCtxHelper,
  nodeSupport,
  type FlowContextHelper,
  type FlowCtx,
  type RunOutcome,
} from "../../shared/nodeSharedExports";
import type { NodeSupport } from "../../shared/nodeSupport";
import { agentRunner, type AgentRunner } from "../../../harness/harnessExports";
import { AgentOutputPipeline } from "../../shared/agentOutput/agentOutputPipeline";
import { mrTargetResolver } from "../../shared/mrTargetResolver";
import { EVENT_KIND } from "../../../constants/vocabulary";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import type { mcpSourcesOf } from "../../../templates/nodeConfig";
import type { NodeRow } from "../../../../db/rows";
import { isHookRejection } from "../mergeRequest/utils/isHookRejection";
import { ResolveEffects } from "./resolveEffects";
import { ResolveOutputContract } from "./resolveContract";
import {
  ResolveInput,
  ResolveOutput,
  RECOVERY_META,
  type ResolveAgentResponse,
} from "./schema";
import { PUSH_STATE, type PushState } from "./constants/pushState";
import { EMPTY_LEDGER, RESOLVE_ARTIFACT_KIND, RECHECK_MS } from "./constants/runFacts";
import { hookFixPrompt } from "./constants/hookFix";
import { artifactContent, finishEvent } from "./utils/finishNotes";
import type { CapturedState, FinishParams } from "./types/resolveFinish";
import type { ResolveEffectLedger } from "./types/resolveEffects";

/** The resolve kind's finisher (§3.11 collaborator): captures the agent's pushed state, applies the recheck/fix ledger and artifact, and finishes the node through NodeSupport + the effect layer. The ONLY writer for this kind's terminal outcome; never a direct status write, never a second agent-output path. */
export class ResolveFinisher {
  private readonly contract: ResolveOutputContract;
  private readonly effects: ResolveEffects;
  /** the ONE agent-output path for this kind's response (step 05) */
  private readonly outputPipeline: AgentOutputPipeline;
  /** the def's bounded feedback-retry budget, spent on contract misses (§6 layer 1) */
  private readonly retryBudget: number;

  constructor(
    private readonly support: NodeSupport = nodeSupport,
    private readonly runner: AgentRunner = agentRunner,
    private readonly ctxHelper: FlowContextHelper = flowCtxHelper,
    private readonly gitHosts: GitHostResolver,
    retryBudget: number = 1,
  ) {
    this.contract = new ResolveOutputContract();
    this.effects = new ResolveEffects(support, gitHosts);
    this.outputPipeline = new AgentOutputPipeline(support);
    this.retryBudget = retryBudget;
  }

  /**
   * The finalize pipeline (§6): contract parse with one bounded feedback retry,
   * push-state verification (§6A), the engine push for unpushed local commits,
   * contract-driven effects from the artifact ledger, then the outcome.
   * Restart recovery re-enters this same path (`restart: true`, no baseline).
   */
  async finish(ctx: FlowCtx, input: ResolveInput, result: AgentRunResult, p: FinishParams): Promise<RunOutcome> {
    // 1) the contract (§6 layer 1): retryable misses get exactly ONE feedback
    //    turn on the same agent session; a second miss fails the node
    const openIds = p.open.map((row) => row.id);
    const response = await this.parseWithRetry(ctx, p, result, openIds);
    const content = artifactContent(response);

    // 2) push-state verification (§6 layer 3 / §6A) — a crashed run's recorded
    //    verify wins and is only re-attempted if it recorded local_only
    const recorded = p.restart ? await this.readRecoveryState(ctx) : null;
    let pushState: PushState;
    let codeChanged: boolean;
    if (recorded?.pushState) {
      pushState = recorded.pushState;
      codeChanged = recorded.codeChanged ?? pushState === PUSH_STATE.PUSHED;
    } else {
      const verified = await this.verifyPushState(ctx, p, p.before);
      pushState = verified.pushState;
      codeChanged = verified.codeChanged;
    }

    // 3) the engine push (§6A, local mode): local-only commits go to the MR
    //    before any thread is closed — never resolve for a commit the reviewer
    //    cannot see. On recovery, pushBranch is a no-op when already pushed.
    let failedPush: string | null = null;
    if (pushState === PUSH_STATE.LOCAL_ONLY) {
      const push = await this.pushLocalBranch(ctx, {
        nodeId: p.node.id,
        repoUrl: p.repoUrl,
        mrBranch: p.mrBranch,
        worktree: p.worktree,
        model: p.model,
        settingSources: p.settingSources,
        label: p.label,
      });
      if (push.pushed) pushState = PUSH_STATE.PUSHED;
      else failedPush = push.reason;
    }

    const baseMeta = {
      summary: response.summary,
      decisions: response.decisions,
      codeChanged,
      pushState,
    };
    const persistProgress = async (ledger: ResolveEffectLedger): Promise<void> => {
      // the ledger rides the artifact meta after every effect (§4) — restart
      // recovery reads exactly this (the review `persistProgress` precedent)
      await this.support.saveArtifact(p.node.id, ctx.flow.id, RESOLVE_ARTIFACT_KIND, content, {
        ...baseMeta,
        ledger,
      });
    };

    // restart recovery completes only the effects the ledger does not hold
    const ledger = recorded?.ledger ?? EMPTY_LEDGER;
    await persistProgress(ledger);

    const counts = await this.effects.apply({
      flowId: ctx.flow.id,
      nodeId: p.node.id,
      repoUrl: p.repoUrl,
      executionMode: ctx.flow.executionMode,
      mrIid: p.mrIid,
      response,
      open: p.open,
      pushState,
      ledger,
      persistProgress,
    });

    const output = ResolveOutput.parse({
      resolved: counts.resolved,
      replied: counts.replied,
      wontfix: counts.wontfix,
      skipped: counts.skipped,
      hostFailures: counts.hostFailures,
      codeChanged,
      pushed: pushState === PUSH_STATE.PUSHED,
      branchName: input.branchName ?? undefined,
    });
    return {
      status: "done" as const,
      output,
      artifact: {
        kind: RESOLVE_ARTIFACT_KIND,
        content,
        meta: { ...baseMeta, hostFailures: counts.hostFailures, ledger: counts.ledger },
      },
      event: finishEvent(input, counts, pushState, failedPush),
      eventData: { codeChanged, pushed: output.pushed, hostFailures: counts.hostFailures, pushState },
      reply: response.summary,
    };
  }

  /**
   * Restart recovery entry (the def's `recover`): rebuild the run's finalize
   * context from the recorded input and re-enter `finish` with `restart: true`
   * — no baseline verify, the ledger picked up from the artifact meta (§6
   * layer 4). `repoUrl` arrives pre-validated: the def maps a missing one to
   * `{ kind: "manual" }` directly, outside the replay-failure wrapper.
   */
  async recoverOutcome(
    ctx: FlowCtx,
    node: NodeRow,
    result: AgentRunResult,
    repoUrl: string,
    settingSources: ReturnType<typeof mcpSourcesOf>,
  ): Promise<RunOutcome> {
    const recorded = ResolveInput.parse(node.input ?? {});
    const { mrIid, mrBranch } = await mrTargetResolver.resolve(ctx, recorded.branchName);
    const open = await this.support.openComments(ctx.flow.id, mrIid);
    return await this.finish(ctx, recorded, result, {
      node,
      repoUrl,
      mrIid,
      mrBranch,
      open,
      before: null,
      worktree: ctx.flow.worktreeDir ?? null,
      label: recorded.branchName ? `resolve (${recorded.branchName})` : "resolve",
      model: recorded.model,
      settingSources,
      restart: true,
    });
  }

  /** MR head SHA + local branch fingerprint before a run (null when unusable). */
  async captureState(
    ctx: FlowCtx,
    repoUrl: string,
    mrIid: number | null,
    mrBranch: string | null,
  ): Promise<CapturedState> {
    const mrSha = mrIid
      ? ((await (await this.gitHosts.forRepo(repoUrl, ctx.flow.executionMode)).getChangeRequest(repoUrl, mrIid).catch(() => null))?.sha ?? null)
      : null;
    const lp = this.ctxHelper.localPath(ctx);
    const localState =
      lp && mrBranch
        ? await localGit.localBranchState(lp, mrBranch, ctx.repo?.defaultBranch ?? "main").catch(() => null)
        : null;
    return { mrSha, localRef: localState?.stat ?? null };
  }

  /**
   * Push the local branch to origin (§6A): origin remote first, token-authed
   * HTTPS fallback, one bounded agent fix turn when a hook rejected the code,
   * then ONE re-push. Infra failures degrade (no node failure — the agent's
   * work is real); a second hook rejection fails the node loudly.
   */
  async pushLocalBranch(
    ctx: FlowCtx,
    p: { nodeId: string; repoUrl: string; mrBranch: string | null; worktree: string | null; model: string | null; settingSources: ReturnType<typeof mcpSourcesOf>; label: string },
  ): Promise<{ pushed: boolean; reason: string | null }> {
    const mrBranch = p.mrBranch;
    if (!mrBranch) return { pushed: false, reason: null };
    const lp = this.ctxHelper.localPath(ctx);
    if (!lp) return { pushed: false, reason: null };
    await this.support.emit(ctx.flow.id, p.nodeId, EVENT_KIND.LOG, `pushing branch ${mrBranch} to origin…`);
    try {
      const how = await localGit.pushBranch(lp, mrBranch, p.repoUrl, gitRemoteContextFor);
      await this.support.emit(
        ctx.flow.id,
        p.nodeId,
        EVENT_KIND.LOG,
        `branch ${mrBranch} pushed (via ${how === "https" ? "token-authed HTTPS" : "origin remote"})`,
      );
      return { pushed: true, reason: null };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isHookRejection(msg)) {
        // infra failure (network/VPN/auth): NOT a node failure — replies still
        // post and the next debounce cycle retries the push (§6A)
        const reason = `push of branch ${mrBranch} failed: ${msg.slice(0, 300)}`;
        await this.support.emit(ctx.flow.id, p.nodeId, EVENT_KIND.ERROR, reason);
        return { pushed: false, reason };
      }
      // hook rejection: the repo's gates spoke — one bounded agent fix turn
      // with the hook output, then one re-push (createWithFixes precedent)
      const hookDetail = msg.slice(0, 2000);
      await this.support.emit(
        ctx.flow.id,
        p.nodeId,
        EVENT_KIND.LOG,
        `push rejected for branch ${mrBranch} by a repo hook — one agent fix turn, then one re-push`,
      );
      await this.runner.executeRun(
        ctx,
        p.nodeId,
        async () =>
          this.runner.startAgent(ctx, {
            prompt: hookFixPrompt(hookDetail, mrBranch),
            mode: "agent",
            name: `${p.label} hook fix ${ctx.task.key}`,
            followUpOn: await this.support.lastAgentId(p.nodeId),
            cwd: p.worktree ?? undefined,
            model: p.model,
            settingSources: p.settingSources,
          }),
        `${p.label} hook fix`,
      );
      try {
        const how = await localGit.pushBranch(lp, mrBranch, p.repoUrl, gitRemoteContextFor);
        await this.support.emit(
          ctx.flow.id,
          p.nodeId,
          EVENT_KIND.LOG,
          `branch ${mrBranch} pushed after the fix turn (via ${how === "https" ? "token-authed HTTPS" : "origin remote"})`,
        );
        return { pushed: true, reason: null };
      } catch (e2: unknown) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        if (isHookRejection(msg2)) {
          throw new Error(
            `the repo's hooks rejected branch ${mrBranch} again after the fix turn — fix the code and retry the node: ${msg2.slice(0, 500)}`,
          );
        }
        const reason = `push of branch ${mrBranch} failed: ${msg2.slice(0, 300)}`;
        await this.support.emit(ctx.flow.id, p.nodeId, EVENT_KIND.ERROR, reason);
        return { pushed: false, reason };
      }
    }
  }

  /**
   * Contract retry (§6 layer 1) through the ONE agent-output pipeline
   * (step 05): retryable misses (`no_json`, `schema_mismatch`) spend the def's
   * `retryBudget` feedback turns on the same agent session; an
   * `agent_reported` propagates immediately with the agent's reason; a
   * budget-exhausted miss throws — the node fails for manual retry.
   */
  private parseWithRetry(
    ctx: FlowCtx,
    p: FinishParams,
    result: AgentRunResult,
    openIds: readonly string[],
  ): Promise<ResolveAgentResponse> {
    return this.outputPipeline.run<ResolveAgentResponse>({
      ctx,
      nodeId: p.node.id,
      label: p.label,
      text: result.result ?? "",
      budget: this.retryBudget,
      validate: (t) => this.contract.parse(t, openIds),
      retryPrompt: (failure) => this.contract.retryPrompt(failure, openIds),
      executeRetry: async (prompt) => {
        const { result: retry } = await this.runner.executeRun(
          ctx,
          p.node.id,
          async () =>
            this.runner.startAgent(ctx, {
              prompt,
              mode: "agent",
              name: `${p.label} ${ctx.task.key}`,
              followUpOn: await this.support.lastAgentId(p.node.id),
              model: p.model,
              settingSources: p.settingSources,
            }),
          `${p.label} contract retry`,
        );
        return retry.result ?? "";
      },
    });
  }

  /**
   * Verify the fix's push state (§6A): the MR head SHA moved (with one bounded
   * recheck), else local commits the remote branch lacks = `local_only`, else
   * `none`. `unknown` when the MR cannot be read at all — loud error event,
   * never closes a thread on unverifiable facts.
   */
  private async verifyPushState(
    ctx: FlowCtx,
    p: FinishParams,
    before: CapturedState | null,
  ): Promise<{ pushState: PushState; codeChanged: boolean }> {
    // 1) MR-head reads: a moved SHA wins immediately. The recheck only follows
    //    a baseline — recovery has none, so one read suffices.
    const reads = before?.mrSha ? [0, RECHECK_MS] : [0];
    let afterSha: string | null = null;
    let readError: string | null = null;
    for (const delay of reads) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        afterSha = (await (await this.gitHosts.forRepo(p.repoUrl, ctx.flow.executionMode)).getChangeRequest(p.repoUrl, p.mrIid))?.sha ?? null;
        if (before?.mrSha && afterSha && afterSha !== before.mrSha) {
          return { pushState: PUSH_STATE.PUSHED, codeChanged: true };
        }
      } catch (e: unknown) {
        readError = e instanceof Error ? e.message : String(e);
      }
    }

    // 2) local branch state — commits the remote branch lacks = local_only
    const lp = this.ctxHelper.localPath(ctx);
    const after =
      lp && p.mrBranch
        ? await localGit.localBranchState(lp, p.mrBranch, ctx.repo?.defaultBranch ?? "main").catch(() => null)
        : null;
    const codeChanged =
      after?.stat != null && before?.localRef != null && after.stat !== before.localRef;
    if (after && after.unpushedAhead > 0) {
      return { pushState: PUSH_STATE.LOCAL_ONLY, codeChanged };
    }

    if (afterSha == null) {
      // 3) verification failed (§6 layer 3): loud — the swallowed "no change"
      //    was the CR-075 class of bug
      await this.support.emit(
        ctx.flow.id,
        p.node.id,
        EVENT_KIND.ERROR,
        `could not verify the MR head on the host${readError ? `: ${readError.slice(0, 300)}` : ""} — threads stay open until the state is verified`,
      );
      return { pushState: PUSH_STATE.UNKNOWN, codeChanged };
    }
    return { pushState: PUSH_STATE.NONE, codeChanged };
  }

  /** The crashed run's persisted ledger + verified push state (restart recovery).
   *  Step 05: an UNPARSEABLE meta THROWS — mapping it to an empty ledger would
   *  re-apply every effect (double-posted replies, re-resolved threads);
   *  recover() maps the throw to `{ kind: "manual" }` with this reason. */
  private async readRecoveryState(ctx: FlowCtx): Promise<{
    ledger: ResolveEffectLedger;
    pushState: PushState | null;
    codeChanged: boolean | null;
  }> {
    const art = await this.support.latestArtifact(ctx.flow.id, RESOLVE_ARTIFACT_KIND, { nodeType: NODE_KEYS.RESOLVE });
    if (!art?.meta) return { ledger: EMPTY_LEDGER, pushState: null, codeChanged: null };
    const parsed = RECOVERY_META.parse(art.meta);
    return {
      ledger: parsed.ledger ?? EMPTY_LEDGER,
      pushState: parsed.pushState ?? null,
      codeChanged: parsed.codeChanged ?? null,
    };
  }
}
