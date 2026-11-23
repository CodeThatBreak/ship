import "server-only";

import type { EffectRegistry } from "../runtime/effects/effectRegistry";
import type { ChainHost } from "../nodes/chains/types/chainHost";
import type { SdlcChain } from "../nodes/chains/sdlcChain";
import type { DeclarativeEffectsHost } from "../nodes/declarativeEffects";
import { registerSdlcEffects } from "../nodes/chains/sdlcEffects";
import { registerDeclarativeEffects } from "../nodes/declarativeEffects";
import { verbRegistry } from "../runtime/effects/verbs/verbWiring";

/**
 * The engine's boot registrations: the post-terminal effects are registered
 * AT ENGINE BOOT, one registry per engine instance. Extracted from the
 * FlowEngine constructor so the composition root stays under its shrink-only
 * arch ceiling — the wiring order here IS the dispatch order.
 *
 * Must never: construct engine collaborators or write state — registration
 * only, exactly the calls the FlowEngine constructor used to inline.
 */

/** The post-terminal effect registrations (Invariant 8): the SDLC chain's
 *  lifecycle effects, then the declarative wildcard effects (relevance from
 *  config, Invariant F1/F3). */
export const registerRuntimeEffects = (
  effects: EffectRegistry,
  host: ChainHost & DeclarativeEffectsHost,
  chain: SdlcChain,
): void => {
  registerSdlcEffects(effects, host, chain);
  registerDeclarativeEffects(effects, verbRegistry, host);
};
