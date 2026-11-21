import "server-only";

import type { EffectVerb } from "../constants/effectVerbs";
import type { FactKind } from "../../../facts/types/facts";

/**
 * Thrown when a declared effect verb cannot run because the fact it requires
 * was never established (task 11 — the effect-layer analogue of
 * `input_contract_violation`): the verb refuses loudly instead of pretending
 * the side effect happened. The caller emits the typed
 * `effect_contract_violation` feed event naming the verb and the missing fact
 * alongside this throw, and no half-established fact exists — the MR (or the
 * verb's other side effect) was never touched.
 */
export class EffectContractViolation extends Error {
  constructor(
    readonly verb: EffectVerb,
    readonly fact: FactKind,
    detail?: string,
  ) {
    super(
      `effect verb "${verb}" requires a "${fact}" fact${detail ? ` — ${detail}` : ""}`,
    );
    this.name = new.target.name;
  }
}
