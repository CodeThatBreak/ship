import "server-only";

import type { EffectRegistry } from "../../runtime/effects/effectRegistry";

/**
 * The orchestrator surface {@link FlowCancelService} drives — the engine's
 * effect/join layer, whose registered lifecycle effects the cancel handler's
 * finalize dispatches through. A deliberate narrow boundary, not a public
 * API; `FlowEngine` implements it.
 */
export interface CancelHost {
  readonly effects: EffectRegistry;
}
