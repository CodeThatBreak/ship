import "server-only";

import type { EffectVerb } from "../constants/effectVerbs";

/**
 * A registered verb descriptor whose run implementation has not landed yet
 * (the verb tasks fill them in). Throwing — not silently no-oping — keeps an
 * authored-but-unwired verb loud: the flow stops at the effect instead of
 * pretending the side effect happened.
 */
export class VerbNotWiredError extends Error {
  constructor(readonly verb: EffectVerb) {
    super(`effect verb "${verb}" is registered but not wired yet`);
    this.name = new.target.name;
  }
}
