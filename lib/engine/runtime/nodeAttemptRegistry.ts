import "server-only";

/**
 * In-process registry of node attempts currently executing in this server.
 * Reconcile uses it so a `running` node with no agent handle yet (worktree
 * setup, prompt assembly, agent startup before persistRun) is not failed as
 * orphaned while the same process is still working on it.
 *
 * Step 02 (decision Q9): no longer a global — an instance field of the
 * container-owned engine services (`lib/composition`), marked by the
 * transition authority's claims. Step 03 removes its liveness role entirely
 * in favor of leases.
 *
 * Step 08: the registry is also the in-process carrier for the claim-minted
 * capability token on its way to the run row (`registerStartupRun` persists
 * it moments after the claim, same request path) and to the prompt assembly
 * (the tools block embeds it). The durable copy is the run row — after a
 * restart the registry is empty and the token still validates off the row.
 */
export class NodeAttemptRegistry {
  private readonly active = new Map<string, string>();
  private readonly tokens = new Map<string, string>();

  mark(nodeId: string, attemptId: string, apiToken?: string): void {
    this.active.set(nodeId, attemptId);
    if (apiToken != null) this.tokens.set(nodeId, apiToken);
  }

  clear(nodeId: string, attemptId?: string | null): void {
    if (attemptId != null && this.active.get(nodeId) !== attemptId) return;
    this.active.delete(nodeId);
    this.tokens.delete(nodeId);
  }

  isActive(nodeId: string): boolean {
    return this.active.has(nodeId);
  }

  matches(nodeId: string, attemptId: string | null | undefined): boolean {
    return attemptId != null && this.active.get(nodeId) === attemptId;
  }

  /** The claim-minted capability token for the node's in-flight attempt, or null. */
  apiTokenOf(nodeId: string): string | null {
    return this.tokens.get(nodeId) ?? null;
  }
}
