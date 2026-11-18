import "server-only";

import type { EngineNodeStatus } from "../../../constants/nodeStatus";
import type { TRANSITION_TABLE } from "../constants/transitionTable";

/**
 * Who may fire a declared transition (step-02 spec): the actor metadata the
 * transition table carries so tests can assert *who* fired a status change.
 */
export type TransitionActor = "trigger" | "effect" | "reconcile" | "user" | "system";

/**
 * One declared edge of the node state machine (target-architecture §2):
 * a from-set (the statuses the node may currently hold), a to-set (the
 * statuses this transition may move it to — usually one), and the actor.
 * Anything not listed in the table is a bug the tests reject.
 */
export interface TransitionRow {
  from: readonly EngineNodeStatus[];
  to: readonly EngineNodeStatus[];
  actor: TransitionActor;
}

/** The declared transition keys — the entire legal vocabulary (Invariant 1). */
export type TransitionKey = keyof typeof TRANSITION_TABLE;

/**
 * A run's terminal outcome as the authority publishes it. `output` arrives
 * already validated by the node's contract (step 04 moves that validation
 * behind the authority's contract seam); the terminal write carries it in the
 * same conditional `UPDATE`.
 */
export interface NodeOutcome {
  status: EngineNodeStatus;
  output: Record<string, unknown>;
  agentId?: string | null;
}

/**
 * One applied transition, recorded in the authority's in-memory log. The test
 * helper (`tests/helpers/transitionLogAssert.ts`) verifies every recorded
 * entry resolves against the declared table — the runtime mirror of the
 * source-scan gate.
 */
export interface TransitionRecord {
  flowId: string;
  nodeKey: string;
  key: TransitionKey;
  to: EngineNodeStatus;
  actor: TransitionActor;
  attemptId?: string;
  at: number;
}
