import "server-only";

import { EFFECT_KEY_ANY, EFFECT_LIFECYCLE, type EffectLifecycle } from "./constants/effectLifecycles";
import type { EffectCtx, EffectHandler, NodeEffects } from "./types/nodeEffects";

/**
 * EffectRegistry — the single mechanism for "what happens after Y finishes"
 * (Invariant 8, target-architecture §7). Node kinds and runtimes register
 * effects keyed by `(defKey, lifecycle)` at engine boot (the FlowEngine
 * constructor — the same boot point that wires the runtimes); the StageRunner
 * consults it after every terminal outcome, the approval door dispatches
 * `afterApproval` on a won approve, and the fan-out/split child-terminal
 * notifications arrive as `onChildTerminal` registrations.
 *
 * Invariants:
 * - Registrations are DATA — the implementations stay in their owning modules
 *   (`sdlcEffects` over the SDLC chain, the fan-out/split runtimes). Never
 *   park sequencing logic in this class.
 * - Effect-driven stage starts claim through the TriggerGateway (the effects
 *   close over the engine's gateway-backed primitives), so a lost claim emits
 *   the same typed `skipped_duplicate_trigger` event a user click would.
 * - Re-entrancy: an effect that starts a stage whose own outcome dispatches
 *   effects again recurses depth-first under the same claim fencing — the
 *   gateway's atomic claims bound it. Never add a dispatch path that skips a
 *   claim.
 *
 * Must never: write node status, decide sequencing for unregistered nodes
 * (unclaimed lifecycles fall through to the caller's default — the template's
 * edge walk), or grow a second registration axis beyond (defKey, lifecycle).
 */
export class EffectRegistry {
  /** (defKey, lifecycle) → handlers. A list because the runtime-owned
   *  wildcard key legitimately carries one handler per registering runtime. */
  private readonly registry = new Map<string, EffectHandler[]>();

  /**
   * Boot-time registration. Registering the IDENTICAL handler twice for the
   * same (defKey, lifecycle) pair is a double-boot wiring bug — throw (the
   * nodeRegistry convention); distinct handlers under the same key are the
   * documented wildcard case (one per registering runtime).
   */
  register(defKey: string, effects: NodeEffects): void {
    for (const lifecycle of Object.values(EFFECT_LIFECYCLE)) {
      const handler = effects[lifecycle];
      if (!handler) continue;
      const key = this.keyOf(defKey, lifecycle);
      const existing = this.registry.get(key) ?? [];
      if (existing.some((h) => h === handler)) {
        throw new Error(`duplicate effect registration: ${defKey} · ${lifecycle}`);
      }
      this.registry.set(key, [...existing, handler]);
    }
  }

  /**
   * The handlers for (defKey, lifecycle): the exact defKey's registrations
   * first, then the runtime-owned wildcard registrations.
   */
  handlersFor(defKey: string, lifecycle: EffectLifecycle): EffectHandler[] {
    return [
      ...(this.registry.get(this.keyOf(defKey, lifecycle)) ?? []),
      ...(this.registry.get(this.keyOf(EFFECT_KEY_ANY, lifecycle)) ?? []),
    ];
  }

  /**
   * Run every handler registered for (ctx.defKey, lifecycle) in registration
   * order: the exact defKey's owners first, then the runtime-owned wildcard
   * registrations. Returns `true` when the follow-on is CLAIMED and the
   * caller must not run its default (the edge walk):
   *
   * - an exact defKey registration claims by existing — the registration IS
   *   the ownership (the SDLC chain's lifecycles);
   * - a wildcard registration claims only by RETURNING `true` — its relevance
   *   is decided inside the handler from config or linkage (the declarative
   *   effects' config-declared verbs), so a wildcard that finds nothing to do
   *   leaves the caller's default intact (Invariant F3: config-absent ⇒
   *   wildcard no-op ⇒ default edge walk, byte-for-byte).
   *
   * `false` means nothing claimed this lifecycle.
   */
  async run(lifecycle: EffectLifecycle, ctx: EffectCtx): Promise<boolean> {
    const exact = this.registry.get(this.keyOf(ctx.defKey, lifecycle)) ?? [];
    for (const handler of exact) {
      await handler(ctx);
    }
    let claimed = exact.length > 0;
    for (const handler of this.registry.get(this.keyOf(EFFECT_KEY_ANY, lifecycle)) ?? []) {
      if ((await handler(ctx)) === true) claimed = true;
    }
    return claimed;
  }

  /** The registered (defKey, lifecycle) pairs, sorted — the snapshot the
   *  registry tests pin (the executable answer to "what happens when X
   *  finishes?"). */
  entries(): Array<{ defKey: string; lifecycle: EffectLifecycle }> {
    const out: Array<{ defKey: string; lifecycle: EffectLifecycle }> = [];
    for (const [key, handlers] of this.registry.entries()) {
      const [defKey, lifecycle] = key.split("\n") as [string, EffectLifecycle];
      for (let i = 0; i < handlers.length; i++) out.push({ defKey, lifecycle });
    }
    return out.sort((a, b) =>
      a.defKey === b.defKey ? a.lifecycle.localeCompare(b.lifecycle) : a.defKey.localeCompare(b.defKey),
    );
  }

  private keyOf(defKey: string, lifecycle: EffectLifecycle): string {
    return `${defKey}\n${lifecycle}`;
  }
}
