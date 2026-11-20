import "server-only";

import type { AgentToolExecutor, AgentToolName } from "./types/tools";

/**
 * The agent-tools registry (step 08, Invariant 10): the name → executor map
 * the AgentToolService dispatches through. Built-ins register their
 * executors here; capability gating is NOT the registry's job — a kind's
 * `agentTools()` allowlist decides what its agent may call, the registry
 * only decides what exists.
 */
export class ToolRegistry {
  private readonly executors = new Map<AgentToolName, AgentToolExecutor>();

  register(executor: AgentToolExecutor): void {
    if (this.executors.has(executor.name)) {
      throw new Error(`duplicate agent tool: ${executor.name}`);
    }
    this.executors.set(executor.name, executor);
  }

  executorOf(name: AgentToolName): AgentToolExecutor | null {
    return this.executors.get(name) ?? null;
  }
}
