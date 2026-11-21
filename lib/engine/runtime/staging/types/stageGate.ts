import "server-only";

/**
 * The outcome one stage gate returns for a (flow, node) stage start (task 24,
 * finding E1):
 *
 * - `"own"` — the gate ran the stage itself (the expansion owns the node;
 *   the def's run is skipped).
 * - `"run"` — not mine; the next registered gate is consulted, and the
 *   frozen default (the def's normal whole path) applies when none claims.
 * - `{ run, afterRun }` — the def's normal whole path runs and the gate
 *   post-processes its output afterwards (the fan-out whole-wrap aggregate).
 */
export type StageGateOutcome =
  | "own"
  | "run"
  | { run: true; afterRun: () => Promise<void> };

/**
 * One runtime's stage-ownership gate: the decision "does this runtime own
 * this node's stage, and if the def still runs, what happens after". The
 * gates claim through the same trigger gateway (Invariant 8) — a gate's
 * claim discipline lives in its owning runtime; the registry only moves the
 * dispatch indirection.
 */
export interface StageGate {
  gate(flowId: string, nodeKey: string): Promise<StageGateOutcome>;
}
