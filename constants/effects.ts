/**
 * Client-safe mirror of the engine's declarative effect vocabulary (§2.7):
 * the closed union and per-lifecycle allowlists live in `lib/engine/runtime/
 * effects/constants/effectVerbs.ts`, but the template editor renders the
 * authoring options, so it needs its own copy. `tests/effectsConfigVocabulary
 * .test.ts` keeps the two from drifting.
 *
 * `EFFECT_LIFECYCLE`, `EFFECT_VERB` and `EffectVerb` mirror the full engine
 * union; only `EFFECT_LIFECYCLE_SECTIONS` — the options the generic authoring
 * form actually offers — is narrowed. It offers just the `afterApproval` MR
 * opt-in: `retrigger_pipeline` and `publish_review_comments` are pipeline and
 * review concerns that throw `effect_contract_violation` on a generic agent
 * node unless its output carries a pipeline id / review comments plus a
 * change_request fact. Those verbs stay in the union and remain reachable via
 * the panel's manual actions and the built-in pipeline/review nodes — they are
 * simply not offered on this form. `publish_diff` is in the engine's
 * `afterSuccess` allowlist but is still an unwired stub that throws, so it is
 * deliberately absent here too.
 */
export const EFFECT_LIFECYCLE = {
  AFTER_APPROVAL: "afterApproval",
  AFTER_SUCCESS: "afterSuccess",
} as const;
export type EffectLifecycle = (typeof EFFECT_LIFECYCLE)[keyof typeof EFFECT_LIFECYCLE];

export const EFFECT_VERB = {
  CREATE_CHANGE_REQUEST: "create_change_request",
  PUBLISH_DIFF: "publish_diff",
  RETRIGGER_PIPELINE: "retrigger_pipeline",
  PUBLISH_REVIEW_COMMENTS: "publish_review_comments",
} as const;
export type EffectVerb = (typeof EFFECT_VERB)[keyof typeof EFFECT_VERB];

export interface EffectVerbOption {
  value: EffectVerb;
  label: string;
}

export interface EffectLifecycleSection {
  key: EffectLifecycle;
  label: string;
  verbs: readonly EffectVerbOption[];
}

/** One checkbox group per lifecycle the effects editor renders — plain-English
 *  labels only, no help or description sub text. */
export const EFFECT_LIFECYCLE_SECTIONS: readonly EffectLifecycleSection[] = [
  {
    key: EFFECT_LIFECYCLE.AFTER_APPROVAL,
    label: "After Approval",
    verbs: [
      {
        value: EFFECT_VERB.CREATE_CHANGE_REQUEST,
        label: "Create Change Request",
      },
    ],
  },
];
