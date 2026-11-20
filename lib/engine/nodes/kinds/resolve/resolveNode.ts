import "server-only";

import type { NodeRow } from "../../../../db/rows";
import { z } from "zod";
import { localGit } from "../../../../git/local";
import { gitHostRegistry, type GitHostResolver } from "../../../ports/gitHost";
import type { AgentRunResult } from "../../../ports/agentPort";
import type { RecoveryResult } from "../../shared/types/recovery";
import { prompts } from "../../../prompts/promptLibrary";
import {
  AgentRunNode,
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
import type { NodeCapabilities } from "../../shared/capabilities";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import type { ConfigField } from "../../../templates/nodeConfig";
import { configString, mcpSourcesOf, mcpSourcesSchema, mcpSourceConfigFields, splitConsumerConfigFields } from "../../../templates/nodeConfig";
import { splitConsumeSchema, splitParallelMaxSchema } from "../../shared/split";
import { mrTargetResolver } from "../../shared/mrTargetResolver";
import { worktreeManager } from "../../../runtime/worktreeLifecycle";
import { ResolveConsumes, ResolveInput, ResolveOutput, RESOLVE_RESPONSE_JSON_SCHEMA } from "./schema";
import { ResolveOutputContract } from "./resolveContract";
import { ResolveFinisher } from "./resolveFinisher";

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
  override readonly consumes = ResolveConsumes;

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

  private readonly contract: ResolveOutputContract;
  /** the finalize/recovery collaborator (step 05 task 8): the def orchestrates,
   *  the finisher owns the §6 pipeline, the engine push, and the recovery path */
  private readonly finisher: ResolveFinisher;

  constructor(
    support: NodeSupport = nodeSupport,
    runner: AgentRunner = agentRunner,
    ctxHelper: FlowContextHelper = flowCtxHelper,
    gitHosts: GitHostResolver = gitHostRegistry,
  ) {
    super(support, runner, ctxHelper);
    this.contract = new ResolveOutputContract();
    this.finisher = new ResolveFinisher(support, runner, ctxHelper, gitHosts, this.retryBudget);
  }

  /**
   * Live prompt preview: the branch resolution mirrors run()'s (mrTargetResolver),
   * and the extras shape is identical to the run's — the contract directive is
   * byte-equal in both by construction (I7); comments/setup_note stay empty
   * (run data, computed at run time). Pre-MR flows (the composer's bulk read
   * renders this preview) keep the flow's configured branch.
   */
  async previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): Promise<NodePromptPreview | null> {
    const configBody = await nodeRoles.previewBody(this, node);
    const mrBranch = ctx.flow.mrIid
      ? (await mrTargetResolver.resolve(ctx, null)).mrBranch
      : ctx.flow.mrBranch ?? this.ctxHelper.buildBranch(ctx);
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
    const repoUrl = ctx.flow.repoUrl;
    if (!repoUrl) {
      // G17: fail loudly instead of falling back to an empty repoUrl that the
      // host registry and pushes would then silently consume
      throw new Error("resolve needs a repository URL — the flow has no repo configured");
    }
    const node = await this.node(ctx);
    const { mrIid, mrBranch } = await mrTargetResolver.resolve(ctx, rawInput.branchName);

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

    const open = await this.support.openComments(ctx.flow.id, mrIid);
    if (!open.length && !input.instructions) {
      // no effects run — every count is zero and `pushed` stays false: nothing
      // was verified on the remote MR head
      return await this.applyOutcome(ctx, {
        status: "done",
        output: this.outputSchema.parse({ resolved: 0, replied: 0, wontfix: 0, skipped: 0 }),
        event: "no open comments",
        reply: "No open comments.",
      });
    }

    // capture the MR head + local branch fingerprint before anything moves —
    // compared after the run to verify code movement and push state (§6A)
    const before = await this.finisher.captureState(ctx, repoUrl, mrIid, mrBranch);

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
          .localBranchState(lp, mrBranch, ctx.repo?.defaultBranch ?? "main")
          .catch(() => null);
        if (ahead && ahead.unpushedAhead > 0) {
          await this.finisher.pushLocalBranch(ctx, {
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
      await this.support.agentReplies(ctx.flow.id, mrIid),
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
        this.finisher.finish(ctx, input, result, {
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
    if (this.isFirstTurn(await this.node(ctx))) {
      const outcome = await this.run(
        ctx,
        ResolveInput.parse({ prompt: content, promptIsBody: true, model: model ?? null }),
        await this.nodeConfig(ctx),
      );
      return outcome.reply;
    }
    return super.chat(ctx, content, model);
  }

  /**
   * Restart recovery re-applies the recorded agent result through the contract
   * and completes the remaining effects from the artifact ledger — the
   * `agentNode.recover` precedent ("recovery is persistence-only"). The fixed
   * recovery ABI: a missing/unparseable recorded state is `manual` with the
   * reason (an UNPARSEABLE ledger meta is manual + the event the recovery
   * seam emits — never an empty-ledger re-apply of already-applied effects).
   */
  async recover(ctx: FlowCtx, node: NodeRow, result: AgentRunResult, note: string): Promise<RecoveryResult> {
    if (result.status !== "finished") {
      return { kind: "manual", reason: `the resolve run ended with ${result.status}` };
    }
    try {
      const repoUrl = ctx.flow.repoUrl;
      if (!repoUrl) return { kind: "manual", reason: "the flow has no repository URL" };
      const outcome = await this.finisher.recoverOutcome(
        ctx,
        node,
        result,
        repoUrl,
        mcpSourcesOf(await this.nodeConfig(ctx)),
      );
      await this.applyOutcome(ctx, outcome, { note: `recovered: ${note}` });
      return { kind: "recovered" };
    } catch (e: unknown) {
      return { kind: "manual", reason: `replaying the resolve run failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}
