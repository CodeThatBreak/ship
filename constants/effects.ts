/**
 * Client-safe mirror of the engine's declarative effect vocabulary (§2.7):
 * the closed union and per-lifecycle allowlists live in `lib/engine/runtime/
 * effects/constants/effectVerbs.ts`, but the template editor renders the
 * authoring options, so it needs its own copy. `tests/effectsConfigVocabulary
 * .test.ts` keeps the two from drifting.
 *
 * Only wired verbs are offered: `publish_diff` is in the engine's
 * `afterSuccess` allowlist but is still an unwired stub that throws, so it is
 * deliberately absent here.
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
  description: string;
}

export interface EffectLifecycleSection {
  key: EffectLifecycle;
  label: string;
  help: string;
  verbs: readonly EffectVerbOption[];
}

/** One checkbox group per lifecycle the effects editor renders. */
export const EFFECT_LIFECYCLE_SECTIONS: readonly EffectLifecycleSection[] = [
  {
    key: EFFECT_LIFECYCLE.AFTER_APPROVAL,
    label: "After approval",
    help: "Run when this node's output is approved — needs a branch fact to open an MR.",
    verbs: [
      {
        value: EFFECT_VERB.CREATE_CHANGE_REQUEST,
        label: EFFECT_VERB.CREATE_CHANGE_REQUEST,
        description: "Open a merge request from the node's branch fact",
      },
    ],
  },
  {
    key: EFFECT_LIFECYCLE.AFTER_SUCCESS,
    label: "After success",
    help: "Run when this node's run finishes successfully.",
    verbs: [
      {
        value: EFFECT_VERB.RETRIGGER_PIPELINE,
        label: EFFECT_VERB.RETRIGGER_PIPELINE,
        description: "Retry the failed jobs of the change request's pipeline",
      },
      {
        value: EFFECT_VERB.PUBLISH_REVIEW_COMMENTS,
        label: EFFECT_VERB.PUBLISH_REVIEW_COMMENTS,
        description: "Post a review run's parsed comments to the change request",
      },
    ],
  },
];
