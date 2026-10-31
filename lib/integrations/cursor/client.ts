import "server-only";

import {
  cursorAgent,
  type AgentRunResult,
  type StreamCallbacks,
  type TokenUsage,
} from "../cursorSdk";
import { parseModelSpec } from "../../modelSpec";
import { processSingleton } from "../../singleton";
import type { AgentRunQuery } from "../../engine/ports/agent-port";

// ── cloud run result / usage shapes (SDK-native, re-exported) ───────────────
// The cloud integration is now a thin adapter over the unified CursorAgentService
// (lib/integrations/cursorSdk.ts). Type names are preserved so the engine's
// consumers keep a stable import site while statuses adopt SDK vocabulary
// ("finished" | "error" | "cancelled").

export type CursorRunResult = AgentRunResult;
export type { StreamCallbacks };

/** Per-run token usage + billed cost (cloud). */
export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cost?: { rawCostCents?: number; chargedCents?: number };
  model?: string;
  [k: string]: unknown;
}

export interface CreateAgentInput {
  prompt: string;
  repos?: { url: string; startingRef?: string }[];
  mode?: "agent" | "plan";
  autoCreatePR?: boolean;
  model?: string;
  name?: string;
  customSubagents?: { name: string; instructions: string }[];
}

/**
 * Cloud agent client, backed by the @cursor/sdk cloud runtime via the unified
 * CursorAgentService. Covers agent creation, follow-up runs, run
 * inspection/cancel, usage reporting, and run-event streaming.
 */
export class CursorClient {
  private modelSelection(model?: string) {
    return parseModelSpec(model);
  }

  async createAgent(input: CreateAgentInput) {
    const started = await cursorAgent.createRun({
      prompt: input.prompt,
      cloud: true,
      repos: input.repos,
      mode: input.mode,
      autoCreatePR: input.autoCreatePR,
      name: input.name,
      customSubagents: input.customSubagents,
      model: this.modelSelection(input.model),
    });
    return { agent: { id: started.agentId }, run: { id: started.runId } };
  }

  async followUp(agentId: string, prompt: string, mode?: "agent" | "plan") {
    const started = await cursorAgent.createRun({
      prompt,
      cloud: true,
      mode,
      resumeAgentId: agentId,
    });
    return { run: { id: started.runId } };
  }

  async getRun(agentId: string, runId: string): Promise<AgentRunQuery> {
    return cursorAgent.getRun(agentId, runId);
  }

  /** Per-run token usage + cost (cloud agents only). */
  async getRunUsage(agentId: string, runId: string): Promise<RunUsage | null> {    const u = await cursorAgent.getRunUsage(agentId, runId);
    if (!u) return null;
    return {
      inputTokens: u.usage.inputTokens,
      outputTokens: u.usage.outputTokens,
      cacheReadTokens: u.usage.cacheReadTokens,
      cacheWriteTokens: u.usage.cacheWriteTokens,
      totalTokens: u.usage.totalTokens,
      reasoningTokens: u.usage.reasoningTokens,
      cost: u.cost,
    } satisfies RunUsage;
  }

  async cancelRun(agentId: string, runId: string): Promise<boolean> {
    return cursorAgent.cancelRun(runId, agentId);
  }

  /** Stream a run to completion, invoking callbacks per event. */
  async streamRun(
    agentId: string,
    runId: string,
    cb: StreamCallbacks = {},
  ): Promise<CursorRunResult> {
    // Prefer a live in-process handle; otherwise re-attach (post-restart) and
    // pump that, falling back to the already-terminal result.
    if (cursorAgent.hasActiveRun(runId)) {
      const { result } = await cursorAgent.streamRun(runId, cb);
      return result;
    }
    const live = await cursorAgent.reattachRun(agentId, runId);
    if (live) return cursorAgent.pumpRun(live, cb);
    const query = await cursorAgent.getRun(agentId, runId);
    if (query.state === "terminal") return query.result as CursorRunResult;
    if (query.state === "unavailable") throw query.error;
    throw new Error(`run ${runId} is still running and could not be re-attached`);
  }
}

export const cursorClient = processSingleton("cursorClient", () => new CursorClient());
