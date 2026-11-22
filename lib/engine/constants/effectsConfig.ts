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
    "Checked: the engine opens a merge request from this node's branch fact when its output is approved. " +
    "Unchecked: no automatic MR is opened — the panel's manual MR action is still available once the branch fact exists.",
};
