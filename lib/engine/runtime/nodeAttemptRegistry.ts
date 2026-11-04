import "server-only";

import { processSingleton } from "../../singleton";

/**
 * In-process registry of node attempts currently executing in this server.
 * Reconcile uses it so a `running` node with no agent handle yet (worktree
 * setup, prompt assembly, agent startup before persistRun) is not failed as
 * orphaned while the same process is still working on it.
 */
export class NodeAttemptRegistry {
  private readonly active = new Map<string, string>();

  mark(nodeId: string, attemptId: string): void {
    this.active.set(nodeId, attemptId);
  }

  clear(nodeId: string, attemptId?: string | null): void {
    if (attemptId != null && this.active.get(nodeId) !== attemptId) return;
    this.active.delete(nodeId);
  }

  isActive(nodeId: string): boolean {
    return this.active.has(nodeId);
  }

  matches(nodeId: string, attemptId: string | null | undefined): boolean {
    return attemptId != null && this.active.get(nodeId) === attemptId;
  }
}

export const nodeAttemptRegistry = processSingleton(
  "nodeAttemptRegistry",
  () => new NodeAttemptRegistry(),
);
