import "server-only";

/**
 * The per-edge activation source the ConditionEvaluator evaluates an edge
 * against: a decision source gates on `label ∈ chosen`; every other edge
 * evaluates its JSONata condition over the (lazily built) flow context.
 * `loud` emits an error event on a broken condition (the advance path);
 * quiet re-evaluations (join/skip checks) just resolve inactive.
 */
export interface EdgeActivationSource {
  decision: boolean;
  chosen: string[] | null;
  ctx: unknown;
  loud?: boolean;
}

/** The resolution state of a target's incoming `next` edges. */
export interface IncomingResolution {
  total: number;
  resolved: number;
  active: number;
}
