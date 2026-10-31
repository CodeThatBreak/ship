import "server-only";

import type {
  AgentPort,
  AgentRunHandle,
  AgentRunQuery,
  AgentRunUsage,
  AgentStartSpec,
  AgentStarted,
  AgentStreamCallbacks,
  AgentStreamOutcome,
  CatalogModel,
} from "../../engine/ports/agent-port";
import { AgentRunWorkspaceError } from "../../engine/ports/agent-errors";
import { localAgent } from "./agent";
import { AgentRunLookupError } from "../../engine/ports/agent-errors";
import { CURSOR_LIST_DISCOUNT, CURSOR_RATE_OVERRIDES } from "../cursor/pricing";

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
  readonly listDiscount = CURSOR_LIST_DISCOUNT;
  readonly rateOverrides = CURSOR_RATE_OVERRIDES;

  async start(spec: AgentStartSpec): Promise<AgentStarted> {
    const workspace = spec.cwd ?? spec.workspace;
    if (!workspace) {
      throw new AgentRunWorkspaceError();
    }
    return localAgent.createRun({
      prompt: spec.prompt,
      workspace,
      cwd: spec.cwd ?? undefined,
      mode: spec.mode,
      sessionId: spec.followUpOn ?? undefined,
      branch: spec.startingRef,
      model: spec.model ?? undefined,
      // ambient MCP/setting layers — applied on create AND resume (the SDK
      // requires settingSources to be re-passed on follow-up runs)
      settingSources: spec.settingSources,
    });
  }

  async stream(handle: AgentRunHandle, callbacks: AgentStreamCallbacks = {}): Promise<AgentStreamOutcome> {
    const out = await localAgent.streamRun(handle.runId, callbacks);
    return { result: out.result, sessionId: out.sessionId };
  }

  async getRun(handle: AgentRunHandle): Promise<AgentRunQuery> {
    if (localAgent.hasActiveRun(handle.runId)) {
      return { state: "running" };
    }
    return {
      state: "unavailable",
      error: new AgentRunLookupError(
        "Local runs are in-process only — use inspectSession after a restart",
        handle.runId,
        handle.agentId ?? undefined,
      ),
    };
  }

  cancel(handle: AgentRunHandle): Promise<boolean> {
    return localAgent.cancelRun(handle.runId);
  }

  hasActiveRun(runId: string): boolean {
    return localAgent.hasActiveRun(runId);
  }

  releaseActiveRun(runId: string): void {
    localAgent.releaseRun(runId);
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
