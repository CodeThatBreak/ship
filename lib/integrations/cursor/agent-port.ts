import "server-only";

import { cursorAgent } from "../cursorSdk";
import { cursorClient } from "./client";
import { cursorApiKey } from "./credentials";
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
/**
 * Cloud agent port: wraps the Cursor cloud client (durable run handles —
 * agent id + run id survive restarts, so runs re-attach and bill usage).
 */
export class CursorCloudAgentPort implements AgentPort {
  readonly kind = "cursor-cloud";
  readonly label = "Cursor cloud";
  readonly execMode = "cloud" as const;
  readonly harness = "cursor";
  readonly fallbackModels: readonly string[] = [];

  async start(spec: AgentStartSpec): Promise<AgentStarted> {
    // Follow-up runs inherit the agent's model.
    if (spec.followUpOn) {
      const r = await cursorClient.followUp(spec.followUpOn, spec.prompt, spec.mode);
      return { agentId: spec.followUpOn, runId: r.run.id as string };
    }
    // spec.settingSources is intentionally NOT forwarded: per the SDK, cloud
    // agents always load project/team/plugins layers plus the MCP servers
    // configured on cursor.com/agents — `settingSources` is local-runtime only.
    const created = await cursorClient.createAgent({
      prompt: spec.prompt,
      mode: spec.mode,
      repos: spec.repos,
      autoCreatePR: spec.autoCreatePR ?? false,
      name: spec.name,
      customSubagents: spec.customSubagents,
      model: spec.model ?? undefined,
    });
    return { agentId: created.agent.id as string, runId: created.run.id as string };
  }

  async stream(handle: AgentRunHandle, callbacks: AgentStreamCallbacks = {}): Promise<AgentStreamOutcome> {
    const agentId = handle.agentId ?? "";
    const result: AgentRunResult = await cursorClient.streamRun(agentId, handle.runId, callbacks);
    return { result };
  }

  getRun(handle: AgentRunHandle): Promise<AgentRunResult | null> {
    return cursorClient.getRun(handle.agentId ?? "", handle.runId);
  }

  async cancel(handle: AgentRunHandle): Promise<boolean> {
    try {
      await cursorClient.cancelRun(handle.agentId ?? "", handle.runId);
      return true;
    } catch {
      return false;
    }
  }

  hasActiveRun(runId: string): boolean {
    return cursorAgent.hasActiveRun(runId);
  }

  async getUsage(handle: AgentRunHandle): Promise<AgentRunUsage | null> {
    const u = await cursorClient.getRunUsage(handle.agentId ?? "", handle.runId);
    if (!u) return null;
    return {
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      totalTokens: u.totalTokens,
      reasoningTokens: u.reasoningTokens,
      cost: u.cost,
    } satisfies AgentRunUsage;
  }

  async inspectSession(): Promise<null> {
    return null; // durable cloud handles — recovery re-attaches via stream(), not sessions
  }

  listCatalog(): Promise<CatalogModel[] | null> {
    return cursorAgent.listCatalog();
  }

  async status(): Promise<{ configured: boolean; detail?: string }> {
    const configured = Boolean(cursorApiKey());
    return {
      configured,
      detail: configured ? undefined : "Cursor API key is not set — add it in Settings → Integrations → Harness",
    };
  }
}
