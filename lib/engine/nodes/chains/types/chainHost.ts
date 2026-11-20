import "server-only";

import type { ChainRole, FlowCtx } from "../../shared/nodeSharedExports";
import type { EngineNodeStatus } from "../../../constants/nodeStatus";
import type { EffectCtx } from "../../../runtime/effects/types/nodeEffects";
import type { EffectLifecycle } from "../../../runtime/effects/constants/effectLifecycles";
import type { TransitionKey } from "../../../runtime/transitions/types/transitions";
import type { TriggerResult, TriggerSource } from "../../../runtime/triggers/types/triggerGateway";

/** The engine surface the chain drives — the generic orchestration primitives. */
export interface ChainHost {
  ctx(flowId: string): Promise<FlowCtx>;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string>;
  /** keyed delegate to the transition authority (declared from→to set) */
  setNodeStatus(flowId: string, nodeKey: string, key: TransitionKey, opts?: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string }): Promise<boolean>;
  claimNode(flowId: string, nodeKey: string, key: TransitionKey): Promise<string>;
  nodeStatus(flowId: string, nodeKey: string): Promise<string | null>;
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  emitLifecycle(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void>;
  emitMrFailed(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void>;
  /** the instance key of the flow's node holding a chain role (§T3 —
   *  metadata-routed; the chain names roles, never literal def keys) */
  keyOfRole(flowId: string, role: ChainRole): Promise<string | null>;
  /** the CI gate node (waits on the pipeline source) */
  gateKey(flowId: string): Promise<string | null>;
  /** resolve a node's outgoing edges and start what becomes eligible */
  advanceFrom(flowId: string, fromKey: string): Promise<void>;
  /** the post-terminal dispatch (step 07): child-terminal notifications +
   *  the registered afterSuccess / loopReentry effects, falling through to
   *  the edge walk when nothing claims the follow-on */
  postTerminal(flowId: string, nodeKey: string): Promise<void>;
  /** the effect registry's dispatch door (step 07): run the effects
   *  registered for (defKey, lifecycle); true when one claimed the follow-on */
  runEffect(lifecycle: EffectLifecycle, ctx: EffectCtx): Promise<boolean>;
  /** the instance keys of the flow's post-MR chain stages (the claim
   *  guard's in-flight set — step 06 folds the old chainBusy read into the
   *  claim UPDATE itself) */
  chainKeys(flowId: string): Promise<string[]>;
  /** the TriggerGateway doors (step 06): every trigger claims here — a lost
   *  claim emits the typed skip event and returns the skipped result */
  claimTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
    chainKeys?: readonly string[];
  }): Promise<TriggerResult>;
  transitionTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
  }): Promise<TriggerResult>;
}
