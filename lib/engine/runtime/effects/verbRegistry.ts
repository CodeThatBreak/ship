import "server-only";

import type { EffectVerb } from "./constants/effectVerbs";
import type { VerbCtx, VerbDescriptor } from "./verbs/types/verbDescriptor";

/**
 * VerbRegistry — the single dispatch point for the declarative effect verbs
 * (design §4.2, task 10). The verb union is CLOSED: a new verb is a code
 * change that registers one descriptor here; declarative configs compose the
 * registered ids, they never invent them (§12.4).
 *
 * Invariants:
 * - Verbs run under the node's attempt claim — the caller (the declarative
 *   wildcard effect) already holds the effect dispatch's claim discipline;
 *   the verb implementations journal their external-I/O sequences through
 *   `jobs` (Invariant 7) when they land.
 * - `run` reports whether the verb actually ran, so the wildcard effect can
 *   claim the follow-on only when it did something (Invariant 8).
 *
 * Must never: grow a second registration axis, accept an unregistered verb
 * id, or park verb implementations inside this class — they live in their
 * owning modules under `verbs/`.
 */
export class VerbRegistry {
  private readonly byId = new Map<EffectVerb, VerbDescriptor>();

  /** Boot-time registration; a duplicate verb id is a double-boot wiring bug —
   *  throw (the EffectRegistry/nodeRegistry convention). */
  register(descriptor: VerbDescriptor): void {
    if (this.byId.has(descriptor.id)) {
      throw new Error(`duplicate verb registration: ${descriptor.id}`);
    }
    this.byId.set(descriptor.id, descriptor);
  }

  /** Run one verb by id. Returns the descriptor's own claim report. An
   *  unregistered id is a config/code drift — throw loudly. */
  async run(verb: EffectVerb, ctx: VerbCtx): Promise<boolean> {
    const descriptor = this.byId.get(verb);
    if (!descriptor) throw new Error(`unknown effect verb: ${verb}`);
    return descriptor.run(ctx);
  }

  /** The registered descriptors, sorted by id — the snapshot the registry
   *  tests pin (the executable answer to "what can a declarative node ask
   *  the engine to do?"). */
  descriptors(): VerbDescriptor[] {
    return [...this.byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}
