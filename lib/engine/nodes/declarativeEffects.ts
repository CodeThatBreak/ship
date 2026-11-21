import "server-only";

import { db } from "../../db/app";
import { ValidationError } from "../../errors";
import { templateStore } from "../templates/templateStore";
import {
  DECLARED_EFFECTS_CONFIG_KEY,
  EFFECT_VERBS_BY_LIFECYCLE,
  type EffectVerb,
} from "../runtime/effects/constants/effectVerbs";
import { EFFECT_KEY_ANY, EFFECT_LIFECYCLE, type EffectLifecycle } from "../runtime/effects/constants/effectLifecycles";
import type { EffectRegistry } from "../runtime/effects/effectRegistry";
import type { EffectCtx } from "../runtime/effects/types/nodeEffects";
import type { VerbRegistry } from "../runtime/effects/verbRegistry";
import { isDeclarativeKind } from "./declarativeRegistry/utils/isDeclarativeKind";

/**
 * The declarative wildcard effects (design §4.2, task 10 — findings B3/F1/F3):
 * declarative nodes declare their side effects in config; dispatch decides
 * relevance from that config, never from a def key. One wildcard registration
 * per verb-bearing lifecycle (`afterApproval`, `afterSuccess`), registered at
 * engine boot beside the built-in runtimes' registrations — the registry's
 * ordering (exact defKey first, wildcard second) keeps the built-ins'
 * compiled effects untouched, and the built-ins' config carries no `effects`
 * map, so the wildcard no-ops for them (Invariant F3).
 *
 * When a declared verb actually ran, the registration claims the follow-on
 * (returns `true` — Invariant 8: the effect owns what happens next, so IT
 * advances the template edges); when nothing ran, the caller's default edge
 * walk proceeds byte-for-byte as before.
 */
export interface DeclarativeEffectsHost {
  /** the node instance's layered config (class ← app ← flow snapshot) */
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  /** the follow-on the claimed lifecycle owns (the caller's default edge walk) */
  advanceFrom(flowId: string, nodeKey: string): Promise<void>;
}

/** The node_templates kind behind a node instance — the wildcard's LINKAGE
 *  read (relevance from config-or-linkage, never a def key, Invariant F1).
 *  Mirrors the ConditionEvaluator's kind resolution: the graph spec's
 *  catalogKind when carried, the row's kind otherwise. */
export const nodeCatalogKind = async (flowId: string, nodeKey: string): Promise<string | null> => {
  const spec = (await templateStore.graphForFlow(flowId))?.byKey.get(nodeKey);
  if (!spec) return null;
  if (spec.catalogKind) return spec.catalogKind;
  const row = await db.prisma.nodeTemplate.findUnique({
    where: { id: spec.nodeTemplateId },
    select: { kind: true },
  });
  return row?.kind ?? null;
};

/** The effect verbs a node's config declares for one lifecycle, validated
 *  against the closed verb union. Absent/empty is the expected default (the
 *  def schemas default the map to `{}`); a malformed map or an unregistered
 *  verb id is a loud config violation, never a silent skip. */
export const declaredEffectVerbs = (
  config: Record<string, unknown>,
  lifecycle: EffectLifecycle,
): EffectVerb[] => {
  const effects = config[DECLARED_EFFECTS_CONFIG_KEY];
  if (effects === undefined || effects === null) return [];
  if (typeof effects !== "object" || Array.isArray(effects)) {
    throw new ValidationError(`${DECLARED_EFFECTS_CONFIG_KEY} config must be an object`);
  }
  const allowed = EFFECT_VERBS_BY_LIFECYCLE[lifecycle];
  if (!allowed) return []; // a lifecycle with no verb vocabulary never declares one
  const declared = (effects as Record<string, unknown>)[lifecycle];
  if (declared === undefined || declared === null) return [];
  if (!Array.isArray(declared)) {
    throw new ValidationError(`${DECLARED_EFFECTS_CONFIG_KEY}.${lifecycle} must be an array of effect verbs`);
  }
  return declared.map((entry) => {
    if (typeof entry !== "string" || !(allowed as readonly string[]).includes(entry)) {
      throw new ValidationError(
        `${DECLARED_EFFECTS_CONFIG_KEY}.${lifecycle}: "${String(entry)}" is not a declarable effect verb`,
      );
    }
    return entry as EffectVerb;
  });
};

/** One lifecycle's dispatch: relevance from the node's config (declarative
 *  kinds only), then the verbs under the node's attempt claim. */
const runDeclaredEffects = async (
  ctx: EffectCtx,
  lifecycle: EffectLifecycle,
  verbs: VerbRegistry,
  host: DeclarativeEffectsHost,
  catalogKindOf: (flowId: string, nodeKey: string) => Promise<string | null> = nodeCatalogKind,
): Promise<boolean> => {
  const kind = await catalogKindOf(ctx.flowId, ctx.nodeKey);
  if (!kind || !isDeclarativeKind(kind)) return false;
  const declared = declaredEffectVerbs(await host.nodeConfigFor(ctx.flowId, ctx.nodeKey), lifecycle);
  if (!declared.length) return false;
  let ran = false;
  for (const verb of declared) {
    if (await verbs.run(verb, ctx)) ran = true;
  }
  if (!ran) return false;
  // a verb ran — this registration owns the follow-on (Invariant 8): advance
  // the template edges the caller would have walked by default
  await host.advanceFrom(ctx.flowId, ctx.nodeKey);
  return true;
};

/** Boot-time registration (called from the FlowEngine constructor beside
 *  `registerSdlcEffects`/`registerFanoutEffects`). The `catalogKindOf` seam
 *  exists for tests; production wiring uses the templateStore-backed read. */
export const registerDeclarativeEffects = (
  effects: EffectRegistry,
  verbs: VerbRegistry,
  host: DeclarativeEffectsHost,
  catalogKindOf: (flowId: string, nodeKey: string) => Promise<string | null> = nodeCatalogKind,
): void => {
  effects.register(EFFECT_KEY_ANY, {
    afterApproval: (ctx) => runDeclaredEffects(ctx, EFFECT_LIFECYCLE.AFTER_APPROVAL, verbs, host, catalogKindOf),
    afterSuccess: (ctx) => runDeclaredEffects(ctx, EFFECT_LIFECYCLE.AFTER_SUCCESS, verbs, host, catalogKindOf),
  });
};
