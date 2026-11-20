/**
 * The fixed `recover()` ABI (Invariant 4, engine overhaul step 05): a node
 * kind's restart recovery is a RESULT, never a throw and never a bare
 * boolean.
 *
 *  - `{ kind: "recovered" }` — the impl produced a terminal outcome (through
 *    `applyOutcome`); the recovery is complete.
 *  - `{ kind: "manual", reason }` — recovery is impossible from the recorded
 *    state; the recovery seam fails the node for manual retry and the reason
 *    names why (the run trail shows it).
 *
 * A `recover()` that throws anyway is caught ONCE at the recovery seam
 * (`FlowEngine.completeNodeFromResult`) and mapped to `manual` + an error
 * event — the reconciler pass itself never sees a recovery throw.
 */
import "server-only";

export type RecoveryResult =
  | { readonly kind: "recovered" }
  | { readonly kind: "manual"; readonly reason: string };
