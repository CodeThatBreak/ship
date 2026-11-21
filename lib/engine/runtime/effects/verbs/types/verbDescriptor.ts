import "server-only";

import type { EffectCtx } from "../../types/nodeEffects";
import type { EffectVerb } from "../../constants/effectVerbs";
import type { FactKind } from "../../../../facts/types/facts";

/**
 * The context one verb run carries: the claiming node's identity — the verb
 * runs under the node's attempt claim (Invariants 7/11), so the context is
 * the same identity the effect dispatch carried. Deeper state (facts,
 * services) comes through the verb implementation's own constructor-injected
 * collaborators, not through this context.
 */
export type VerbCtx = EffectCtx;

/**
 * One registered verb (design §4.2): a typed descriptor binding the closed
 * verb id to its service-wrapping run and the facts it requires. The
 * registry's shape is final — later verb tasks (11, 19) only fill `run`
 * implementations; they never grow the descriptor's surface.
 */
export interface VerbDescriptor {
  id: EffectVerb;
  /** the facts the verb needs established before it can run — a node missing
   *  one fails loudly with a typed event naming the fact + the verb (the
   *  effect-layer analogue of `input_contract_violation`, task 11). */
  requiredFacts: readonly FactKind[];
  /** the service-wrapping run. Returns `true` when the verb actually ran —
   *  the wildcard effect's claim to the follow-on (Invariant 8). */
  run(ctx: VerbCtx): Promise<boolean>;
}
