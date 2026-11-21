import "server-only";

import { EFFECT_KEY_ANY } from "../effects/constants/effectLifecycles";
import type { EffectRegistry } from "../effects/effectRegistry";
import type { SubflowManager } from "./subflowManager/subflowManager";

/**
 * The subflow runtime's effect registration (task 26, Invariant 8): the
 * child-terminal notification — a terminal subflow child publishes the
 * parent's aggregate through the join — becomes an `onChildTerminal`
 * registration, the same shape as the fan-out and split runtimes'.
 * Registered under the runtime-owned wildcard key: the effect itself no-ops
 * when the child carries no subflow linkage (the payload marker or the
 * running-parent derivation), and fan-out/split children never match.
 *
 * The rollup stays in this runtime (`onChildFinished` → the aggregate
 * publish → the edge evaluation on a success terminal) — it is reached only
 * through this registration.
 */
export const registerSubflowEffects = (registry: EffectRegistry, subflowFlows: SubflowManager): void => {
  registry.register(EFFECT_KEY_ANY, {
    onChildTerminal: (ctx) => subflowFlows.onChildFinished(ctx.flowId),
  });
};
