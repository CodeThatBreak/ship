import type {
  AgentPort,
  AgentRunHandle,
  AgentRunResult,
  AgentRunUsage,
  AgentStartSpec,
  AgentStarted,
  AgentStreamCallbacks,
  AgentStreamOutcome,
  CatalogModel,
} from "../../engine/ports/agent-runner";
import { localAgent } from "./agent";

/**
 * Local agent port: wraps the local agent service (in-process agent loop over
 * the same SDK runtime). Runs live in-process (never durable across restarts)
 * — recovery probes the persisted agent session via inspectSession, and
 * usage is account-gated (no billed cost).
 */
export class CursorLocalAgentPort implements AgentPort {
  readonly kind = "cursor-local";
  readonly label = "Cursor local";
  readonly execMode = "local" as const;
  readonly harness = "cursor";
  readonly fallbackModels = ["composer-2.5", "auto"];

  async start(spec: AgentStartSpec): Promise<AgentStarted> {
    return localAgent.createRun({
      prompt: spec.prompt,
      // worktree wins: branch checkout (ensureBranch) must run in the worktree,
      // never in the hub — a hub checkout would steal the developer's branch
      workspace: spec.cwd ?? spec.workspace ?? "",
      cwd: spec.cwd ?? undefined,
      mode: spec.mode,
      sessionId: spec.followUpOn ?? undefined,
      branch: spec.startingRef,
      model: spec.model ?? undefined,
    });
  }

  async stream(handle: AgentRunHandle, callbacks: AgentStreamCallbacks = {}): Promise<AgentStreamOutcome> {
    const out = await localAgent.streamRun(handle.runId, callbacks);
    return { result: out.result, sessionId: out.sessionId };
  }

  /**
   * Local runs are in-process: there is no durable "getRun" — recovery goes
   * through inspectSession instead.
   */
  async getRun(): Promise<AgentRunResult | null> {
    return null;
  }

  async cancel(handle: AgentRunHandle): Promise<boolean> {
    return localAgent.cancelRun(handle.runId);
  }

  hasActiveRun(runId: string): boolean {
    return localAgent.hasActiveRun(runId);
  }

  async getUsage(): Promise<AgentRunUsage | null> {
    return null; // local runs are account-gated, never billed here
  }

  inspectSession(sessionId: string, runId: string, workspace: string) {
    return localAgent.inspectSession(sessionId, runId, workspace);
  }

  listCatalog(): Promise<CatalogModel[] | null> {
    return localAgent.listCatalog();
  }

  async status(): Promise<{ configured: boolean; detail?: string }> {
    const ok = await localAgent.cliAvailable();
    return {
      configured: ok,
      detail: ok ? undefined : "Local runs require Node 22.13+ and the Cursor API key (Settings → Integrations → Harness)",
    };
  }
}
