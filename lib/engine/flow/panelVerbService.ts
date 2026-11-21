import "server-only";

import { db } from "../../db/app";
import { NodeRow } from "../../db/rows";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { parseRow } from "@/lib/db/ormRowHelpers";
import { nodeCatalogKind, declaredEffectVerbs } from "../nodes/declarativeEffects";
import { isDeclarativeKind } from "../nodes/declarativeRegistry/utils/isDeclarativeKind";
import { EFFECT_LIFECYCLE } from "../runtime/effects/constants/effectLifecycles";
import type { EffectVerb } from "../runtime/effects/constants/effectVerbs";
import { verbRegistry } from "../runtime/effects/verbs/verbWiring";
import type { VerbCtx } from "../runtime/effects/verbs/types/verbDescriptor";
import { isInFromSet, toStatusOf } from "../runtime/transitions/utils/transitionLookup";
import { TRIGGER_SOURCE } from "../runtime/triggers/constants/triggerSources";
import type { TriggerResult } from "../runtime/triggers/types/triggerGateway";
import type { PanelVerbHost } from "./types/panelVerbHost";

/**
 * PanelVerbService — the panel's direct verb door (task 12, design §4.2 use
 * case 4): a declarative node's panel can fire a declared effect verb
 * without an approval hold — the "Open PR" affordance. No new dispatch
 * path: the same flow-action route, the same TriggerGateway door and the
 * same VerbRegistry the approval's wildcard effect dispatches through.
 *
 * Capability rule: the effects declaration IS the capability (design §4.2
 * declares no separate capability vocabulary) — the node's effective config
 * must declare the verb under `effects.afterApproval`, and the node must be
 * a declarative kind (Invariant F3 — a declarative effect never runs for a
 * built-in node).
 *
 * Claim discipline (Invariant 11): the trigger claims through the
 * TriggerGateway's transition door — the `panelVerb` row's terminal from-set
 * IS the fence, so a concurrent click loses atomically and emits the typed
 * skip event the route maps to 409. The status read only pre-checks
 * eligibility (the claim's from-set still decides — the manual-run
 * precedent); the status is preserved because the verb never touches
 * `nodes.status`, stamped back through the mirror row's to-set.
 *
 * Must never: write node status outside the declared row, run a verb the
 * config does not declare, or bypass the gateway with a direct claim.
 */
export class PanelVerbService {
  constructor(private readonly host: PanelVerbHost) {}

  async run(flowId: string, nodeKey: string, verb: EffectVerb, branchName?: string): Promise<TriggerResult> {
    const row = await db.prisma.node.findFirst({ where: { flowId, nodeKey } });
    const node = row ? parseRow(NodeRow, row, `node ${nodeKey} for flow ${flowId}`) : null;
    if (!node) throw new NotFoundError("node", nodeKey);
    if (!isInFromSet("panelVerb", node.status)) {
      throw new ConflictError(`${nodeKey} is ${node.status} — open the change request after its run finishes`);
    }
    const kind = await nodeCatalogKind(flowId, nodeKey);
    if (!kind || !isDeclarativeKind(kind)) {
      throw new ValidationError(`${nodeKey} is not a declarative node — no panel verb is declared for it`);
    }
    const declared = declaredEffectVerbs(
      await this.host.nodeConfigFor(flowId, nodeKey),
      EFFECT_LIFECYCLE.AFTER_APPROVAL,
    );
    if (!declared.includes(verb)) {
      throw new ValidationError(`${nodeKey} does not declare the "${verb}" effect verb`);
    }
    // the gateway door (Invariant 11): the terminal from-set is the fence —
    // a lost claim emits the typed skip event and the route answers 409
    const triggered = await this.host.transitionTrigger({
      flowId,
      nodeKey,
      source: TRIGGER_SOURCE.UI,
      key: "panelVerb",
      toStatus: toStatusOf("panelVerb", node.status),
    });
    if (!triggered.started) return triggered;
    const def = await this.host.defOf(flowId, nodeKey);
    const ctx: VerbCtx = {
      flowId,
      nodeKey,
      defKey: def.key,
      status: node.status,
      output: node.output ?? null,
      attemptId: null,
      source: TRIGGER_SOURCE.UI,
      ...(branchName ? { params: { branchName } } : {}),
    };
    await verbRegistry.run(verb, ctx);
    return { started: true };
  }
}
