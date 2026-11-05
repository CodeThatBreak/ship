import "server-only";

import type { NodeRow, CommentRow } from "../../../../db/rows";
import { z } from "zod";
import { localGit } from "../../../../git/local";
import {
  gitRemoteContextFor,
  gitHostRegistry,
  type GitHostResolver,
} from "../../../ports/gitHost";
import type { AgentRunResult } from "../../../ports/agentPort";
import { prompts } from "../../../prompts/promptLibrary";
import {
  AgentRunNode,
  TemplateRenderer,
  flowCtxHelper,
  nodeSupport,
  nodeRoles,
  type FlowContextHelper,
  type FlowCtx,
  type NodePromptPreview,
  type PromptPreviewParams,
  type RunOutcome,
} from "../../shared/nodeSharedExports";
import type { NodeSupport } from "../../shared/nodeSupport";
import type { AgentRunner } from "../../../harness/harnessExports";
import { agentRunner } from "../../../harness/harnessExports";
import { AgentOutputError } from "../../shared/agent/outputError/outputErrorExports";
import { EVENT_KIND } from "../../../constants/vocabulary";
import type { NodeCapabilities } from "../../shared/capabilities";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import type { ConfigField } from "../../../templates/nodeConfig";
import { configString, mcpSourcesOf, mcpSourcesSchema, mcpSourceConfigFields, splitConsumerConfigFields } from "../../../templates/nodeConfig";
import { splitConsumeSchema, splitParallelMaxSchema } from "../../shared/split";
import { mrTargetResolver } from "../../shared/mrTargetResolver";
import { worktreeManager } from "../../../runtime/worktreeLifecycle";
import { isHookRejection } from "../mergeRequest/errors";
import { ResolveInput, ResolveOutput, RESOLVE_RESPONSE_JSON_SCHEMA } from "./schema";
import { ResolveEffects } from "./resolveEffects";
import { ResolveOutputContract } from "./resolveContract";
import { RETRYABLE_OUTPUT_ERRORS } from "./constants/retryableErrors";
import { PUSH_STATE } from "./constants/pushState";
import type { ResolveAgentResponse, ResolveCommentDecision } from "./schema";
import type { ResolveEffectLedger } from "./types/resolveEffects";
import type { PushState } from "./constants/pushState";

const RESOLVE_ARTIFACT_KIND = "resolve";

/** One bounded MR-head recheck: guards a push landing just after the run. */
const RECHECK_MS = 5_000;

/** MR-head + local branch fingerprint before a run (null when unusable). */
interface CapturedState {
  mrSha: string | null;
  localRef: string | null;
}

/** Everything finalize (and restart recovery) needs around the agent result. */
interface FinishParams {
  node: NodeRow;
  repoUrl: string;
  mrIid: number;
  mrBranch: string | null;
  /** the open rows whose ids the prompt presented — the contract coverage set */
  open: readonly CommentRow[];
  /** pre-run verified state; null on restart recovery (no baseline exists) */
  before: CapturedState | null;
  worktree: string | null;
  label: string;
  model: string | null;
  settingSources: ReturnType<typeof mcpSourcesOf>;
  /** restart recovery mode: no baseline verify, ledger picked up from the artifact */
  restart: boolean;
}

const EMPTY_LEDGER: ResolveEffectLedger = { replies: [], resolvedDiscussions: [] };

/** The recovery schema of the resolve artifact meta — what a crashed run's
 *  restart needs to pick back up: the idempotency ledger (G10) and the
 *  engine-verified push state + codeChanged computed before the crash. */
const RECOVERY_META = z.object({
  ledger: z
    .object({
      replies: z.array(z.object({ hash: z.string(), noteId: z.string() })),
      resolvedDiscussions: z.array(z.string()),
    })
    .optional(),
  pushState: z
    .enum([PUSH_STATE.PUSHED, PUSH_STATE.LOCAL_ONLY, PUSH_STATE.NONE, PUSH_STATE.UNKNOWN])
    .optional(),
  codeChanged: z.boolean().optional(),
});

/** Artifact content: the agent's summary plus the rendered per-comment decision list. */
const artifactContent = (response: ResolveAgentResponse): string => {
  const decisionLine = (d: ResolveCommentDecision): string =>
    `- [${d.id}] ${d.action}${d.reply ? ` — replied: ${d.reply}` : ""}${d.note ? ` (${d.note})` : ""}`;
  return TemplateRenderer.compose(response.summary)
    .addBlankLine()
    .addLines(response.decisions.map(decisionLine))
    .build();
};

/** The run's push-state story for the lifecycle event (§6A: the states read
 *  differently — "fixes pushed" vs "fixes committed locally but push failed"). */
const pushNote = (pushState: PushState, failedPush: string | null): string => {
  switch (pushState) {
    case PUSH_STATE.PUSHED:
      return " — fixes pushed";
    case PUSH_STATE.LOCAL_ONLY:
      return failedPush
        ? ` — fixes committed locally but push failed: ${failedPush.slice(0, 200)}`
        : " — fixes committed locally but not pushed";
    case PUSH_STATE.UNKNOWN:
      return " — MR state could not be verified";
    default:
      return "";
  }
};

const finishEvent = (
  input: ResolveInput,
  counts: { resolved: number; replied: number; hostFailures: number },
  pushState: PushState,
  failedPush: string | null,
): string =>
  `resolved ${counts.resolved} thread(s), replied ${counts.replied}` +
  `${input.branchName ? ` (${input.branchName})` : ""}` +
  `${pushNote(pushState, failedPush)}` +
  `${counts.hostFailures ? ` — ${counts.hostFailures} host effect(s) failed` : ""}`;

/** The bounded hook-fix turn's prompt: the hook output, the worktree, one fix. */
const hookFixPrompt = (hookDetail: string, branch: string): string =>
  TemplateRenderer.compose(
    `The engine's push of branch ${branch} was rejected by a repository hook (pre-push/pre-receive).`,
  )
    .addBlankLine()
    .section("Hook output", hookDetail)
    .addBlankLine()
    .addLine(
      "Fix the failure in this worktree, commit the fix to the branch, and answer with one JSON object " +
        '{"summary": "<what you fixed>"} — the engine will re-push once.',
    )
    .build();

export class ResolveNode extends AgentRunNode<ResolveInput, ResolveOutput> {
  readonly key = NODE_KEYS.RESOLVE;
  readonly label = "Resolve";
  /** §T4: chat messages refine the resolve — re-run with them as instructions.
   *  The first turn before a run carries the resolve prompt body (composer-as-
   *  prompt, plan's precedent); later ones the instructions. */
  override readonly capabilities: NodeCapabilities = {
    panelTitle: "Comment resolution",
    refinable: true,
    promptNode: NODE_KEYS.RESOLVE,
    startLabel: "Resolve comments",
  };
  /** Engine-dispatch metadata (§T3): the resolve kind occupies the chain's resolve role. */
  override readonly chainRole = NODE_KEYS.RESOLVE;
  readonly promptKeys = [NODE_KEYS.RESOLVE] as const;
  override readonly promptSections = [NODE_KEYS.RESOLVE] as const;
  readonly order = 50;
  override readonly edges = [[NODE_KEYS.PIPELINE, "loop"]] as const;

  readonly inputSchema = ResolveInput;
  readonly outputSchema = ResolveOutput;

  /** Typed config knobs (defaults = today's behavior). */
  override readonly configSchema = z.object({
    prompt_body: z.string().optional(),
    /** quiet-period minutes before the debounced resolve fires; unset = the 10-min default — engine-consumed */
    quiet_minutes: z.number().min(0).optional(),
    /** ambient MCP servers for agent runs (Cursor local.settingSources) */
    mcp_sources: mcpSourcesSchema,
    // split-consumption knob (agent-node split plan §2.4 — Phase 4): default whole = today
    split_consume: splitConsumeSchema,
    split_parallel_max: splitParallelMaxSchema,
  });
  override readonly configFields = [
    { key: "prompt_body", label: "Prompt body", type: "text", help: "User-editable prompt body; internal contracts re-appended automatically." },
    { key: "quiet_minutes", label: "Quiet period (min)", type: "number", help: "Minutes of comment quiet before the debounced resolve fires. Empty = 10." },
    ...mcpSourceConfigFields,
    // the split-consumption section (agent-node split plan §2.4 — Phase 4)
    ...splitConsumerConfigFields,
  ] as const satisfies readonly ConfigField[];

  private readonly gitHosts: GitHostResolver;
  private readonly contract: ResolveOutputContract;
  private readonly effects: ResolveEffects;

  constructor(
    support: NodeSupport = nodeSupport,
    runner: AgentRunner = agentRunner,
    ctxHelper: FlowContextHelper = flowCtxHelper,
    gitHosts: GitHostResolver = gitHostRegistry,
  ) {
    super(support, runner, ctxHelper);
    this.gitHosts = gitHosts;
    this.contract = new ResolveOutputContract();
    this.effects = new ResolveEffects(support, gitHosts);
  }

  /**
   * Live prompt preview: the branch resolution mirrors run()'s (mrTargetResolver),
   * and the extras shape is identical to the run's — the contract directive is
   * byte-equal in both by construction (I7); comments/setup_note stay empty
   * (run data, computed at run time). Pre-MR flows (the composer's bulk read
   * renders this preview) keep the flow's configured branch.
   */
  previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): NodePromptPreview | null {
    const configBody = nodeRoles.previewBody(this, node);
    const mrBranch = ctx.flow.mr_iid
      ? mrTargetResolver.resolve(ctx, null).mrBranch
      : ctx.flow.mr_branch ?? this.ctxHelper.buildBranch(ctx);
    const contractDirective = AgentOutputError.directive(RESOLVE_RESPONSE_JSON_SCHEMA);
    const asm = prompts.assemblePrompt(
      NODE_KEYS.RESOLVE,
      { branch: mrBranch ?? undefined },
      {
        dev_instructions: params.instructions ? `Developer instructions: ${params.instructions}` : "",
        comments: "",
        contract: contractDirective,
        setup_note: "",
      },
      { body: configBody },
    );
    return { templateKey: NODE_KEYS.RESOLVE, configBody, assembly: asm };
  }

  async run(ctx: FlowCtx, rawInput: ResolveInput, config: Record<string, unknown>): Promise<RunOutcome> {
    const repoUrl = ctx.flow.repo_url;
    if (!repoUrl) {
      // G17: fail loudly instead of falling back to an empty repoUrl that the
      // host registry and pushes would then silently consume
      throw new Error("resolve needs a repository URL — the flow has no repo configured");
    }
    const node = this.node(ctx);
    const { mrIid, mrBranch } = mrTargetResolver.resolve(ctx, rawInput.branchName);

    const mode = this.ctxHelper.execMode(ctx);
    const label = rawInput.branchName ? `resolve (${rawInput.branchName})` : "resolve";
    const settingSources = mcpSourcesOf(config);

    // the prompt-body knob folds into the per-run prompt override path —
    // rebuilt through the schema (G16: no mutation, no cast)
    let input = ResolveInput.parse(rawInput);
    if (!input.prompt) {
      const body = configString(config, "prompt_body");
      if (body) input = ResolveInput.parse({ ...input, prompt: body, promptIsBody: true });
    }

    const open = this.support.openComments(ctx.flow.id, mrIid);
    if (!open.length && !input.instructions) {
      // no effects run — every count is zero and `pushed` stays false: nothing
      // was verified on the remote MR head
      return this.applyOutcome(ctx, {
        status: "done",
        output: this.outputSchema.parse({ resolved: 0, replied: 0, wontfix: 0, skipped: 0 }),
        event: "no open comments",
        reply: "No open comments.",
      });
    }

    // capture the MR head + local branch fingerprint before anything moves —
    // compared after the run to verify code movement and push state (§6A)
    const before = await this.captureState(ctx, repoUrl, mrIid, mrBranch);

    let worktree: string | null = null;
    let setupNote: string | null = null;
    if (mode === "local" && mrBranch) {
      // comment fixes run in the flow's worktree (same tree the build used;
      // ensure is a no-op/reuse when it already exists with mrBranch checked out)
      const binding = await worktreeManager.ensureFlowWorktree(ctx, mrBranch, { nodeId: node.id });
      worktree = binding.dir;
      setupNote = binding.setupNote;
      // §6A pre-run flush: a previous cycle's stranded local commits go to the
      // MR before the agent starts (the captures above predate this push, so
      // its MR-head movement lands inside this run's verified delta)
      const lp = this.ctxHelper.localPath(ctx);
      if (lp) {
        const ahead = await localGit
          .localBranchState(lp, mrBranch, ctx.repo?.default_branch ?? "main")
          .catch(() => null);
        if (ahead && ahead.unpushedAhead > 0) {
          await this.pushLocalBranch(ctx, {
            nodeId: node.id,
            repoUrl,
            mrBranch,
            worktree,
            model: input.model,
            settingSources,
            label,
          });
        }
      }
    }

    const presented = this.contract.presentComments(
      open,
      this.support.agentReplies(ctx.flow.id, mrIid),
    );
    const contractDirective = AgentOutputError.directive(RESOLVE_RESPONSE_JSON_SCHEMA);

    // byte-parity rule (I7): internal-block whitespace is normalized inside
    // PromptLibrary — one assembly for the default and the prompt-body path
    const prompt = prompts
      .assemblePrompt(
        NODE_KEYS.RESOLVE,
        { branch: mrBranch ?? undefined },
        {
          dev_instructions: input.instructions ? `Developer instructions: ${input.instructions}` : "",
          comments: presented.text,
          contract: contractDirective,
          setup_note: setupNote ?? "",
        },
        input.prompt ? { body: input.prompt } : {},
      ).final;

    return this.execute(ctx, {
      input: { ...input, prompt },
      prompt,
      agent: {
        mode: "agent",
        name: `${label} ${ctx.task.key}`,
        startingRef: mrBranch ?? undefined,
        cwd: worktree ?? undefined,
        model: input.model,
        settingSources,
      },
      label,
      finalize: (result) =>
        this.finishRun(ctx, input, result, {
          node,
          repoUrl,
          mrIid,
          mrBranch,
          open,
          before,
          worktree,
          label,
          model: input.model,
          settingSources,
          restart: false,
        }),
    });
  }

  /**
   * The finalize pipeline (§6): contract parse with one bounded feedback retry,
   * push-state verification (§6A), the engine push for unpushed local commits,
   * contract-driven effects from the artifact ledger, then the outcome.
   * Restart recovery re-enters this same path (`restart: true`, no baseline).
   */
  private async finishRun(ctx: FlowCtx, input: ResolveInput, result: AgentRunResult, p: FinishParams): Promise<RunOutcome> {
    // 1) the contract (§6 layer 1): retryable misses get exactly ONE feedback
    //    turn on the same agent session; a second miss fails the node
    const openIds = p.open.map((row) => row.id);
    const response = await this.parseWithRetry(ctx, p, result, openIds);
    const content = artifactContent(response);

    // 2) push-state verification (§6 layer 3 / §6A) — a crashed run's recorded
    //    verify wins and is only re-attempted if it recorded local_only
    const recorded = p.restart ? this.readRecoveryState(ctx) : null;
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
    const persistProgress = (ledger: ResolveEffectLedger): void => {
      // the ledger rides the artifact meta after every effect (§4) — restart
      // recovery reads exactly this (the review `persistProgress` precedent)
      this.support.saveArtifact(p.node.id, ctx.flow.id, RESOLVE_ARTIFACT_KIND, content, {
        ...baseMeta,
        ledger,
      });
    };

    // restart recovery completes only the effects the ledger does not hold
    const ledger = recorded?.ledger ?? EMPTY_LEDGER;
    persistProgress(ledger);

    const counts = await this.effects.apply({
      flowId: ctx.flow.id,
      nodeId: p.node.id,
      repoUrl: p.repoUrl,
      mrIid: p.mrIid,
      response,
      open: p.open,
      pushState,
      ledger,
      persistProgress,
    });

    const output = this.outputSchema.parse({
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
   * Contract retry (§6 layer 1): retryable misses (`no_json`, `schema_mismatch`)
   * get ONE feedback turn on the same agent session; an `agent_reported`
   * propagates immediately with the agent's reason; a second miss throws —
   * the node fails for manual retry.
   */
  private async parseWithRetry(
    ctx: FlowCtx,
    p: FinishParams,
    result: AgentRunResult,
    openIds: readonly string[],
  ): Promise<ResolveAgentResponse> {
    let failure: AgentOutputError;
    try {
      return this.contract.parse(result.result ?? "", openIds);
    } catch (e: unknown) {
      if (!(e instanceof AgentOutputError) || !RETRYABLE_OUTPUT_ERRORS.has(e.code)) throw e;
      failure = e;
    }
    this.support.emitLifecycle(
      ctx.flow.id,
      p.node.id,
      `resolve output contract failed — one retry with feedback (${failure.code})`,
    );
    const { result: retry } = await this.runner.executeRun(
      ctx,
      p.node.id,
      () =>
        this.runner.startAgent(ctx, {
          prompt: this.contract.retryPrompt(failure, openIds),
          mode: "agent",
          name: `${p.label} ${ctx.task.key}`,
          followUpOn: this.support.lastAgentId(p.node.id),
          model: p.model,
          settingSources: p.settingSources,
        }),
      `${p.label} contract retry`,
    );
    // a second miss throws — one bounded retry, then a failed node
    return this.contract.parse(retry.result ?? "", openIds);
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
        afterSha = (await this.gitHosts.forRepo(p.repoUrl).getChangeRequest(p.repoUrl, p.mrIid))?.sha ?? null;
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
        ? await localGit.localBranchState(lp, p.mrBranch, ctx.repo?.default_branch ?? "main").catch(() => null)
        : null;
    const codeChanged =
      after?.stat != null && before?.localRef != null && after.stat !== before.localRef;
    if (after && after.unpushedAhead > 0) {
      return { pushState: PUSH_STATE.LOCAL_ONLY, codeChanged };
    }

    if (afterSha == null) {
      // 3) verification failed (§6 layer 3): loud — the swallowed "no change"
      //    was the CR-075 class of bug
      this.support.emit(
        ctx.flow.id,
        p.node.id,
        EVENT_KIND.ERROR,
        `could not verify the MR head on the host${readError ? `: ${readError.slice(0, 300)}` : ""} — threads stay open until the state is verified`,
      );
      return { pushState: PUSH_STATE.UNKNOWN, codeChanged };
    }
    return { pushState: PUSH_STATE.NONE, codeChanged };
  }

  /**
   * Push the local branch to origin (§6A): origin remote first, token-authed
   * HTTPS fallback, one bounded agent fix turn when a hook rejected the code,
   * then ONE re-push. Infra failures degrade (no node failure — the agent's
   * work is real); a second hook rejection fails the node loudly.
   */
  private async pushLocalBranch(
    ctx: FlowCtx,
    p: { nodeId: string; repoUrl: string; mrBranch: string | null; worktree: string | null; model: string | null; settingSources: ReturnType<typeof mcpSourcesOf>; label: string },
  ): Promise<{ pushed: boolean; reason: string | null }> {
    const mrBranch = p.mrBranch;
    if (!mrBranch) return { pushed: false, reason: null };
    const lp = this.ctxHelper.localPath(ctx);
    if (!lp) return { pushed: false, reason: null };
    this.support.emit(ctx.flow.id, p.nodeId, EVENT_KIND.LOG, `pushing branch ${mrBranch} to origin…`);
    try {
      const how = await localGit.pushBranch(lp, mrBranch, p.repoUrl, gitRemoteContextFor);
      this.support.emit(
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
        this.support.emit(ctx.flow.id, p.nodeId, EVENT_KIND.ERROR, reason);
        return { pushed: false, reason };
      }
      // hook rejection: the repo's gates spoke — one bounded agent fix turn
      // with the hook output, then one re-push (createWithFixes precedent)
      const hookDetail = msg.slice(0, 2000);
      this.support.emit(
        ctx.flow.id,
        p.nodeId,
        EVENT_KIND.LOG,
        `push rejected for branch ${mrBranch} by a repo hook — one agent fix turn, then one re-push`,
      );
      await this.runner.executeRun(
        ctx,
        p.nodeId,
        () =>
          this.runner.startAgent(ctx, {
            prompt: hookFixPrompt(hookDetail, mrBranch),
            mode: "agent",
            name: `${p.label} hook fix ${ctx.task.key}`,
            followUpOn: this.support.lastAgentId(p.nodeId),
            cwd: p.worktree ?? undefined,
            model: p.model,
            settingSources: p.settingSources,
          }),
        `${p.label} hook fix`,
      );
      try {
        const how = await localGit.pushBranch(lp, mrBranch, p.repoUrl, gitRemoteContextFor);
        this.support.emit(
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
        this.support.emit(ctx.flow.id, p.nodeId, EVENT_KIND.ERROR, reason);
        return { pushed: false, reason };
      }
    }
  }

  /** The crashed run's persisted ledger + verified push state (restart recovery). */
  private readRecoveryState(ctx: FlowCtx): {
    ledger: ResolveEffectLedger;
    pushState: PushState | null;
    codeChanged: boolean | null;
  } {
    const art = this.support.latestArtifact(ctx.flow.id, RESOLVE_ARTIFACT_KIND, { nodeType: NODE_KEYS.RESOLVE });
    if (!art?.meta) return { ledger: EMPTY_LEDGER, pushState: null, codeChanged: null };
    try {
      const parsed = RECOVERY_META.parse(JSON.parse(art.meta));
      return {
        ledger: parsed.ledger ?? EMPTY_LEDGER,
        pushState: parsed.pushState ?? null,
        codeChanged: parsed.codeChanged ?? null,
      };
    } catch {
      return { ledger: EMPTY_LEDGER, pushState: null, codeChanged: null };
    }
  }

  /** MR head SHA + local branch fingerprint before a run (null when unusable). */
  private async captureState(
    ctx: FlowCtx,
    repoUrl: string,
    mrIid: number | null,
    mrBranch: string | null,
  ): Promise<CapturedState> {
    const mrSha = mrIid
      ? ((await this.gitHosts
          .forRepo(repoUrl)
          .getChangeRequest(repoUrl, mrIid)
          .catch(() => null))?.sha ?? null)
      : null;
    const lp = this.ctxHelper.localPath(ctx);
    const localState =
      lp && mrBranch
        ? await localGit.localBranchState(lp, mrBranch, ctx.repo?.default_branch ?? "main").catch(() => null)
        : null;
    return { mrSha, localRef: localState?.stat ?? null };
  }

  /** Chat maps the message onto the node's guidance field (§T4b recipe). */
  protected override chatInput(content: string, model?: string): Record<string, unknown> {
    return { instructions: content, model: model ?? null };
  }

  /**
   * The first turn on a never-run node runs the resolve with the message as
   * the prompt body (the shape the retired prompt modal produced); turns
   * after a run are the `instructions` refine.
   */
  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    if (this.isFirstTurn(this.node(ctx))) {
      const outcome = await this.run(
        ctx,
        ResolveInput.parse({ prompt: content, promptIsBody: true, model: model ?? null }),
        this.nodeConfig(ctx),
      );
      return outcome.reply;
    }
    return super.chat(ctx, content, model);
  }

  /**
   * Restart recovery re-applies the recorded agent result through the contract
   * and completes the remaining effects from the artifact ledger — the
   * `agentNode.recover` precedent ("recovery is persistence-only"). Returns
   * false when the recorded input/result is missing or unparseable → the
   * reconciler fails the node for manual retry.
   */
  async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<boolean> {
    if (result.status !== "finished") return false;
    try {
      const repoUrl = ctx.flow.repo_url;
      if (!repoUrl) return false;
      const recorded = this.inputSchema.parse(node.input ?? {});
      const { mrIid, mrBranch } = mrTargetResolver.resolve(ctx, recorded.branchName);
      const open = this.support.openComments(ctx.flow.id, mrIid);
      const outcome = await this.finishRun(ctx, recorded, result, {
        node,
        repoUrl,
        mrIid,
        mrBranch,
        open,
        before: null,
        worktree: ctx.flow.worktree_dir ?? null,
        label: recorded.branchName ? `resolve (${recorded.branchName})` : "resolve",
        model: recorded.model,
        settingSources: mcpSourcesOf(this.nodeConfig(ctx)),
        restart: true,
      });
      this.applyOutcome(ctx, outcome, { note: `recovered: ${note}` });
      return true;
    } catch {
      return false;
    }
  }
}
