import "server-only";

import type { EngineNodeStatus } from "../../../constants/nodeStatus";
import type { TransitionKey } from "../../transitions/types/transitions";
import type { TRIGGER_SOURCE } from "../constants/triggerSources";

/** The trigger sources the gateway distinguishes (step 06). */
export type TriggerSource = (typeof TRIGGER_SOURCE)[keyof typeof TRIGGER_SOURCE];

/**
 * The gateway's result-object convention (step 06 task 1): no path returns
 * silently and no path throws for a duplicate — every trigger caller gets
 * exactly one of these two shapes, and the routes map them to 200 started /
 * 409 `skipped_duplicate_trigger`. `attemptId` is present only for claim
 * doors (run starts); approval-style doors carry no attempt token.
 */
export type TriggerResult =
  | { readonly started: true; readonly attemptId?: string }
  | {
      readonly started: false;
      readonly skipped: true;
      readonly reason: "skipped_duplicate_trigger";
    };

/** The parameters the claim door takes: the trigger kind's declared
 *  from-set (`key`) plus the optional chain in-flight guard keys that ride
 *  the same conditional UPDATE. */
export interface TriggerClaimParams {
  flowId: string;
  nodeKey: string;
  source: TriggerSource;
  key: TransitionKey;
  chainKeys?: readonly string[];
}

/** The parameters the approval-style door takes. */
export interface TriggerTransitionParams {
  flowId: string;
  nodeKey: string;
  source: TriggerSource;
  key: TransitionKey;
  toStatus?: EngineNodeStatus;
}
