import "server-only";

import { EFFECT_KEY_ANY } from "../effects/constants/effectLifecycles";
import type { EffectRegistry } from "../effects/effectRegistry";
import type { SplitManager } from "./splitManager";

/**
 * The split runtime's effect registrations (step 07, Invariant 8): the
 * child-terminal notification — a finished split unit releases dependents /
 * publishes the consumer's aggregate through the join — becomes an
 * `onChildTerminal` registration instead of the engine's `isStepChild()`
 * sprinkles. Registered under the runtime-owned wildcard key: split children
 * may run any node kind (the unit's target), and the effect itself no-ops
 * when the flow carries no split linkage.
 *
 * The join stays in this runtime (`onChildFinished` → advance → the
 * worst-of publish) — it is reached only through this registration.
 */
export const registerSplitEffects = (registry: EffectRegistry, splitManager: SplitManager): void => {
  registry.register(EFFECT_KEY_ANY, {
    onChildTerminal: (ctx) => splitManager.onChildFinished(ctx.flowId),
  });
};
