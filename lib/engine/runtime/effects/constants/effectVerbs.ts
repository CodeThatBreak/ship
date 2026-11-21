import "server-only";

import { EFFECT_LIFECYCLE, type EffectLifecycle } from "./effectLifecycles";

/**
 * The closed declarative effect verb union (design §4.2, task 10): what a
 * declarative node's config may ask the engine to DO after a lifecycle fires.
 * Verbs are capability code, not data — a new verb is an engineering change
 * that lands in exactly one task and registers into the VerbRegistry; users
 * compose verbs in config, they never invent them.
 */
export const EFFECT_VERB = {
  /** open a change request (MR) from the node's established branch fact */
  CREATE_CHANGE_REQUEST: "create_change_request",
  /** publish the node's diff artifact as a first-class fact projection */
  PUBLISH_DIFF: "publish_diff",
  /** retry the failed jobs of the change request's recorded pipeline (task 17) */
  RETRIGGER_PIPELINE: "retrigger_pipeline",
} as const;
export type EffectVerb = (typeof EFFECT_VERB)[keyof typeof EFFECT_VERB];

/** The verbs the `afterApproval` config lifecycle accepts (the def schema's
 *  `z.enum` source and the run-time validator's allowlist — one vocabulary,
 *  no drift). */
export const EFFECT_VERBS_AFTER_APPROVAL = [EFFECT_VERB.CREATE_CHANGE_REQUEST] as const;

/** The verbs the `afterSuccess` config lifecycle accepts (task 17:
 *  `retrigger_pipeline` is an afterSuccess-class action — fired from the
 *  panel, never dispatched automatically by a lifecycle). */
export const EFFECT_VERBS_AFTER_SUCCESS = [EFFECT_VERB.PUBLISH_DIFF, EFFECT_VERB.RETRIGGER_PIPELINE] as const;

/** The lifecycle each verb declares under — the panel verb door's capability
 *  check resolves the verb's OWN lifecycle, so a panel verb is validated
 *  against the allowlist it belongs to (one vocabulary, no drift with the
 *  per-lifecycle allowlists above). */
export const EFFECT_VERB_LIFECYCLE: Record<EffectVerb, EffectLifecycle> = {
  [EFFECT_VERB.CREATE_CHANGE_REQUEST]: EFFECT_LIFECYCLE.AFTER_APPROVAL,
  [EFFECT_VERB.PUBLISH_DIFF]: EFFECT_LIFECYCLE.AFTER_SUCCESS,
  [EFFECT_VERB.RETRIGGER_PIPELINE]: EFFECT_LIFECYCLE.AFTER_SUCCESS,
};

/** The verbs each config lifecycle accepts — a lifecycle absent here accepts
 *  no verbs (the wildcard effect never claims it). */
export const EFFECT_VERBS_BY_LIFECYCLE: Partial<Record<EffectLifecycle, readonly EffectVerb[]>> = {
  [EFFECT_LIFECYCLE.AFTER_APPROVAL]: EFFECT_VERBS_AFTER_APPROVAL,
  [EFFECT_LIFECYCLE.AFTER_SUCCESS]: EFFECT_VERBS_AFTER_SUCCESS,
};

/** The declarative def config key holding the effects map (§5's `effects`
 *  knob — read by the declarative wildcard effects). */
export const DECLARED_EFFECTS_CONFIG_KEY = "effects";
