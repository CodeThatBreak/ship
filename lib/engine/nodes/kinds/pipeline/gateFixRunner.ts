import "server-only";

import type { NodeRow } from "../../../../db/rows";
import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { NodeSupport } from "../../shared/nodeSupport";
import type { AgentRunner } from "../../../harness/harnessExports";
import { agentRunner } from "../../../harness/harnessExports";
import { gitHostRegistry, type GitHostResolver, type HostJob } from "../../../ports/gitHost";
import { RunSupersededError } from "../../../errors/runSupersededError";
import { prompts } from "../../../prompts/promptLibrary";
import { TemplateRenderer } from "../../shared/templateRenderer";
import { flowCtxHelper, type FlowContextHelper } from "../../shared/runContext";
import { nodeSupport } from "@/lib/composition/container";
import { FIX_PROMPT_KEY } from "./constants/waiting";
import type { PipelineInput } from "./schema";
/** The per-job log cap the fix prompt assembles (the existing 3×8k budget). */
const FIX_JOB_LOGS = 3;
const FIX_JOB_TRACE_TAIL = 8000;

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
    const jobs = await (await this.gitHosts.forRepo(repoUrl)).listPipelineJobs(repoUrl, pipelineId);
    const failed = jobs.filter((j: HostJob) => j.status === "failed");
    let logs = "";
    for (const j of failed.slice(0, FIX_JOB_LOGS)) {
      const trace = await (await this.gitHosts.forRepo(repoUrl))
        .getJobTrace(repoUrl, j.id)
        .catch(() => "");
      logs += `\n\n===== job ${j.name} (#${j.id}) =====\n${trace.slice(-FIX_JOB_TRACE_TAIL)}`;
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

    let result: Awaited<ReturnType<typeof this.runner.executeRun>>;
    try {
      result = await this.runner.executeRun(
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

    await this.support.saveArtifact(
      node.id,
      ctx.flow.id,
      "fix",
      result.result.result ?? "",
      { pipelineId, attempt },
    );
    await this.support.emitLifecycle(
      ctx.flow.id,
      node.id,
      `fix run ${attempt} pushed to ${mrBranch} — waiting for the new pipeline`,
      { pipelineId },
    );
  }
}
