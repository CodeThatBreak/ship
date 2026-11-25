import "server-only";

import type { NodeRow } from "../../../../db/rows";
import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { NodeSupport } from "../../shared/nodeSupport";
import type { AgentRunner } from "../../../harness/harnessExports";
import { agentRunner } from "../../../harness/harnessExports";
import { gitHostRegistry, type GitHostResolver, type HostJob } from "../../../ports/gitHost";
import { RunSupersededError } from "../../../errors/runSupersededError";
import { prompts } from "../../../prompts/promptLibrary";
import { flowCtxHelper } from "../../shared/runContext";
import type { FlowContextHelper } from "../../shared/runContext/flowContextHelper";
import { nodeSupport } from "@/lib/composition/container";
import { EVENT_KIND, ARTIFACT_KIND } from "../../../constants/vocabulary";
import { hasRunUsage, runUsagePayload } from "../../../usage/runUsagePayload";
import { FIX_PROMPT_KEY } from "./constants/waiting";
import { assembleFixLogs } from "./utils/fixLogs";
import type { PipelineInput } from "./schema";

/**
 * GateFixRunner — the CI gate's fix-agent runs (step 05 decomposition of
 * `pipelineNode`): fetch the failed jobs' logs, assemble the fix prompt (the
 * run/preview-shared assembly), execute one agent run on the fix branch, and
 * persist the fix artifact. The wait loop owns WHEN to fix; this class owns
 * HOW a fix run happens.
 *
 * Must never: loop (the wait loop owns the bounded budget), or swallow a
 * superseded run — a cancelled/retried gate surfaces as `RunSupersededError`
 * and ends the fix quietly.
 */
export class GateFixRunner {
  constructor(
    private readonly support: NodeSupport = nodeSupport,
    private readonly runner: AgentRunner = agentRunner,
    private readonly ctxHelper: FlowContextHelper = flowCtxHelper,
    private readonly gitHosts: GitHostResolver = gitHostRegistry,
  ) {}

  /** Run the fix agent against a failed pipeline: fetch logs, prompt, execute. */
  async fix(args: {
    ctx: FlowCtx;
    node: NodeRow;
    input: PipelineInput;
    pipelineId: number;
    mrBranch: string | null;
    attempt: number;
    maxFixAttempts: number;
    label: string;
  }): Promise<void> {
    const { ctx, node, input, pipelineId, mrBranch, attempt, maxFixAttempts, label } = args;
    const repoUrl = ctx.flow.repoUrl ?? "";
    const host = await this.gitHosts.forRepo(repoUrl, ctx.flow.executionMode);
    const jobs = await host.listPipelineJobs(repoUrl, pipelineId);
    const failed = jobs.filter((j: HostJob) => j.status === "failed");
    // loud caps (step 05): every cap that bites is announced in-prompt AND
    // folded into ONE log event naming the caps — silent truncation is banned
    const { logs, truncations } = await assembleFixLogs(failed, (job) =>
      host.getJobTrace(repoUrl, job.id).catch(() => ""),
    );
    if (truncations.length > 0) {
      await this.support.emit(
        ctx.flow.id,
        node.id,
        EVENT_KIND.LOG,
        `pipeline fix prompt logs truncated: ${truncations.join("; ")}`,
      );
    }

    const mode = this.ctxHelper.execMode(ctx);
    const instructions =
      mode === "local" ? `Start by checking out branch ${mrBranch}.` : "";
    const guidance = input.guidance
      ? `Developer guidance: ${input.guidance}`
      : "";

    // byte-parity rule (I7): internal-block whitespace is normalized inside
    // PromptLibrary — no per-node collapse, preview and run stay identical
    const prompt = input.prompt
      ? input.promptIsBody
        ? prompts.assemblePrompt(
            FIX_PROMPT_KEY,
            { branch: mrBranch ?? "", pipelineId: String(pipelineId) },
            { instructions, guidance, logs: logs || "(logs unavailable)" },
            { body: input.prompt },
          ).final
        : input.prompt
      : prompts.resolve(
          FIX_PROMPT_KEY,
          { branch: mrBranch ?? "", pipelineId: String(pipelineId) },
          { instructions, guidance, logs: logs || "(logs unavailable)" },
        );

    await this.support.emitLifecycle(
      ctx.flow.id,
      node.id,
      `pipeline #${pipelineId} failed — fix run ${attempt}/${maxFixAttempts}`,
      { pipelineId, attempt },
    );

    let run: Awaited<ReturnType<typeof this.runner.executeRun>>;
    try {
      run = await this.runner.executeRun(
        ctx,
        node.id,
        () =>
          this.runner.startAgent(ctx, {
            prompt,
            mode: "agent",
            name: `${label} fix ${ctx.task.key}`,
            startingRef: mrBranch ?? undefined,
            model: input.model,
          }),
        `${label} fix`,
      );
    } catch (e) {
      if (e instanceof RunSupersededError) return;
      throw e;
    }

    await this.support.transaction(async (tx) => {
      await this.support.saveArtifact(
        node.id,
        ctx.flow.id,
        "fix",
        run.result.result ?? "",
        { pipelineId, attempt },
        undefined,
        tx,
      );
      if (hasRunUsage(run.usage)) {
        await this.support.saveArtifact(
          node.id,
          ctx.flow.id,
          ARTIFACT_KIND.USAGE,
          JSON.stringify(runUsagePayload(run.usage)),
          undefined,
          undefined,
          tx,
        );
      }
    });
    await this.support.emitLifecycle(
      ctx.flow.id,
      node.id,
      `fix run ${attempt} pushed to ${mrBranch} — waiting for the new pipeline`,
      { pipelineId },
    );
  }
}
