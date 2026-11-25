import "server-only";

import { cursorAgent, type StreamCallbacks } from "../cursorSdk";
import { parseModelSpec } from "../../modelSpec";
import { usageFromResult } from "./utils/runnerUsage";
import type { RunnerStartInput, RunnerStreamResult } from "./types/runnerTypes";

/**
 * The SDK-facing half of local agent runs: creates, streams, cancels and probes
 * runs on the `@cursor/sdk` local runtime. Instantiated ONLY inside the
 * local-agent host process (`worker/localAgentHost.ts`), because the SDK builds
 * agent shell environments from this process's `process.env` and the host is
 * the process whose marker is removed.
 *
 * Must never: be imported by the web process (that would put run handles back
 * in a process whose env is the problem), or hold database/settings access —
 * the web-side facade resolves defaults and passes them in.
 */
export class LocalAgentRunner {
  /** True when this process still owns the given run (false after a restart). */
  hasActiveRun(runId: string): boolean {
    return cursorAgent.hasActiveRun(runId);
  }

  async available(): Promise<boolean> {
    return cursorAgent.available();
  }

  async listModels(): Promise<string[] | null> {
    return cursorAgent.listModels();
  }

  async listCatalog() {
    return cursorAgent.listCatalog();
  }

  /**
   * Start a local run and issue its first send, so agentId/runId are real
   * before returning. Events are consumed via {@link streamRun}.
   */
  async createRun(input: RunnerStartInput): Promise<{ agentId: string; runId: string }> {
    if (!(await cursorAgent.available())) {
      throw new Error(
        "Local agent runs require Node 22.13+ and the Cursor API key. Set the key in Settings → Integrations → Harness.",
      );
    }
    return cursorAgent.createRun({
      prompt: input.prompt,
      cloud: false,
      cwd: input.cwd ?? input.workspace,
      mode: input.mode,
      model: input.model ? parseModelSpec(input.model) : undefined,
      sandbox: input.sandbox ?? false,
      force: input.force ?? true,
      resumeAgentId: input.resumeAgentId,
      settingSources: input.settingSources,
    });
  }

  /** Stream a run to completion (no timeout — the web-side facade owns that). */
  async streamRun(runId: string, cb: StreamCallbacks = {}): Promise<RunnerStreamResult> {
    const { result, agentId } = await cursorAgent.streamRun(runId, cb);
    return { result, sessionId: agentId, usage: usageFromResult(result) };
  }

  cancelRun(runId: string): Promise<boolean> {
    return cursorAgent.cancelRun(runId);
  }

  releaseRun(runId: string): void {
    cursorAgent.releaseRun(runId);
  }

  /** Read a finished local run's last turn from the persisted SDK store. */
  async inspectSession(
    sessionId: string,
    runId: string,
    workspace: string,
  ): Promise<{ completed: boolean; text: string } | null> {
    return cursorAgent.inspectLocalRun(sessionId, runId, workspace);
  }
}
