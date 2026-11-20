import "server-only";

import { EFFECT_KEY_ANY } from "../effects/constants/effectLifecycles";
import type { EffectRegistry } from "../effects/effectRegistry";
import type { StepFlowManager } from "./stepFlowManager";

/**
 * The plan fan-out runtime's effect registrations (step 07, Invariant 8):
 * the child-terminal notification — a finished step child reschedules its
 * siblings / publishes the parent's aggregate through the roll-up — becomes
 * an `onChildTerminal` registration instead of the engine's `isStepChild()`
 * sprinkles. Registered under the runtime-owned wildcard key: the fan-out
 * runtime owns whole child FLOWS (any node kind a step template runs), and
 * the effect itself no-ops when the flow carries no fan-out linkage.
 *
 * The roll-up stays in this runtime (`onChildFinished` → scheduleRollup →
 * the aggregate publish) — it is reached only through this registration.
 */
export const registerFanoutEffects = (registry: EffectRegistry, stepFlows: StepFlowManager): void => {
  registry.register(EFFECT_KEY_ANY, {
    onChildTerminal: (ctx) => stepFlows.onChildFinished(ctx.flowId),
  });
};
