import "server-only";

import type { AgentRunResult, TokenUsage } from "../../cursorSdk";

/** Token usage as the host reports it to the engine. */
export interface RunnerUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
  model?: string;
}

/** Map an SDK `RunResult`'s TokenUsage into the engine's local usage shape. */
export const usageFromResult = (result: AgentRunResult): RunnerUsage | null => {
  const usage: TokenUsage | undefined = result.usage;
  const model = result.model?.id;
  if (!usage && result.durationMs == null && !model) return null;
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    cacheReadTokens: usage?.cacheReadTokens,
    cacheWriteTokens: usage?.cacheWriteTokens,
    durationMs: result.durationMs,
    model,
  };
};
