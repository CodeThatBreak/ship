import "server-only";

import type { EffectRegistry } from "../runtime/effects/effectRegistry";
import type { StageGateRegistry } from "../runtime/staging/stageGateRegistry";
import type { ChainHost } from "../nodes/chains/types/chainHost";
import type { SdlcChain } from "../nodes/chains/sdlcChain";
import type { DeclarativeEffectsHost } from "../nodes/declarativeEffects";
import { stepFlows } from "../runtime/fanout/stepFlowManager";
import { splitManager } from "../runtime/split/splitManager";
import { subflowFlows } from "../runtime/subflow/subflowManager";
import { registerFanoutStageGate } from "../runtime/fanout/fanoutStageGate";
import { registerSplitStageGate } from "../runtime/split/splitStageGate";
import { registerSubflowStageGate } from "../runtime/subflow/subflowStageGate";
import { registerSdlcEffects } from "../nodes/chains/sdlcEffects";
import { registerFanoutEffects } from "../runtime/fanout/fanoutEffects";
import { registerSplitEffects } from "../runtime/split/splitEffects";
import { registerSubflowEffects } from "../runtime/subflow/subflowEffects";
import { registerDeclarativeEffects } from "../nodes/declarativeEffects";
import { verbRegistry } from "../runtime/effects/verbs/verbWiring";

/**
 * The engine's boot registrations (tasks 24/26): the stage-ownership gates
 * and the post-terminal effects are registered AT ENGINE BOOT, one registry
 * per engine instance. Extracted from the FlowEngine constructor so the
 * third gate (subflow) and its effect land without growing the composition
 * root past its shrink-only arch ceiling — the wiring order here IS the
 * dispatch order and the registry snapshot tests pin it.
 *
 * Must never: construct engine collaborators or write state — registration
 * only, exactly the calls the FlowEngine constructor used to inline.
 */

/** The stage-ownership gates in the frozen evaluation order: fan-out first,
 *  then split, then subflow (task 26 extends, never reorders). */
export const registerStageGates = (gates: StageGateRegistry): void => {
  registerFanoutStageGate(gates, stepFlows);
  registerSplitStageGate(gates, splitManager);
  registerSubflowStageGate(gates, subflowFlows);
};

/** The post-terminal effect registrations (Invariant 8): the SDLC chain's
 *  lifecycle effects, the runtimes' child-terminal wildcards (fan-out →
 *  split → subflow — the onChildTerminal dispatch order), then the
 *  declarative wildcard effects (relevance from config, Invariant F1/F3). */
export const registerRuntimeEffects = (
  effects: EffectRegistry,
  host: ChainHost & DeclarativeEffectsHost,
  chain: SdlcChain,
): void => {
  registerSdlcEffects(effects, host, chain);
  registerFanoutEffects(effects, stepFlows);
  registerSplitEffects(effects, splitManager);
  registerSubflowEffects(effects, subflowFlows);
  registerDeclarativeEffects(effects, verbRegistry, host);
};
