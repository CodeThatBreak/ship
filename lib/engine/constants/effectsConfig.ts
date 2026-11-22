import "server-only";

import type { ConfigField } from "../templates/nodeConfig";

/**
 * The declarative `effects` knob every declarative kind declares. It is a
 * nested object (`{ afterApproval: [...], afterSuccess: [...] }`), so the
 * template editor renders it with the bespoke `EffectsConfigFields` block
 * rather than a plain `json` box — see `DeclarativeConfigFields`'s key
 * dispatch. The def schemas (`DeclarativeEffectsSchema`) re-validate whatever
 * the editor writes at save time.
 */
export const EFFECTS_CONFIG_FIELD: ConfigField = {
  key: "effects",
  label: "Effects",
  type: "json",
  help:
    "Side effects the engine runs automatically after this node's lifecycle — e.g. create_change_request opens an MR from the node's branch fact on approval. " +
    "Automatic only: the panel's manual action is always available once the verb's fact exists, declared or not.",
};
