import "server-only";

import { nodeRegistry } from "../registry";
import { templateStore } from "../../templates/templateStore";
import type { SplitTargetLookup } from "./split";

/**
 * The production `SplitTargetLookup` (agent-node split plan §2.3): builtin
 * chain node keys via the node registry, declarative `node_templates` rows
 * via the template store. Mirrors `declarativeDef`'s row lookup — by row id,
 * then by catalog key with builtin rows excluded (a builtin knob-override
 * row is not a split target), so the split target namespace stays disjoint
 * from the builtin keys by construction.
 */
export const flowSplitTargetLookup: SplitTargetLookup = {
  isNodeKey: (key) => nodeRegistry.has(key),
  template: (idOrKey) => {
    const byId = templateStore.nodeTemplate(idOrKey);
    if (byId) return { id: byId.id };
    const byKey = templateStore.nodeTemplateByKey(idOrKey);
    return byKey && byKey.is_builtin === 0 ? { id: byKey.id } : null;
  },
};
