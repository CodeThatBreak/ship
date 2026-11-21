import "server-only";

import { NODE_KEYS } from "../../constants/nodeKeys";
import { EFFECT_VERB, type EffectVerb } from "../../runtime/effects/constants/effectVerbs";

/**
 * The panel verb door's built-in verbs (task 17): verbs the door offers on a
 * BUILT-IN node definition — no declarative `effects` config exists to
 * declare them, so the verb's own required-fact contract is the capability
 * (the `retrigger_pipeline` verb fails loudly without the established
 * `change_request` fact and the node's recorded pipeline id). Keys are
 * built-in def keys (the `NodeDefinition.key` the registry resolves
 * built-ins by — a built-in `node_templates` row's `kind` is the opaque
 * `"builtin"`, so the def key is the only identity that distinguishes them).
 *
 * Declarative verbs are NOT here: for them the effects declaration IS the
 * capability (design §4.2) — the door validates the verb against the node's
 * declaration under the verb's owning lifecycle (`EFFECT_VERB_LIFECYCLE`),
 * and a declarative effect never runs for a built-in node (Invariant F3).
 */
export const PANEL_VERB_BUILTIN_DEFS: Partial<Record<EffectVerb, readonly string[]>> = {
  [EFFECT_VERB.RETRIGGER_PIPELINE]: [NODE_KEYS.PIPELINE],
};
