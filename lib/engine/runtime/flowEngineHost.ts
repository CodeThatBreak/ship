import "server-only";

import type { FlowCtx, NodeDefinition } from "../nodes/shared/nodeSharedExports";
import type { EngineNodeStatus } from "../constants/nodeStatus";
import type { TransitionKey } from "./transitions/types/transitions";
import type { TriggerResult, TriggerSource } from "./triggers/types/triggerGateway";

/** The keyed transition opts the engine's wrappers forward to the authority. */
export type KeyedTransitionOpts = {
  toStatus?: EngineNodeStatus;
  patch?: Record<string, unknown>;
  detail?: string;
};

/** The TriggerGateway claim door's parameter shape, shared by the hosts that
 *  start runs (step 06 — the atomic duplicate fence). */
export type GatewayClaimParams = {
  flowId: string;
  nodeKey: string;
  source: TriggerSource;
  key: TransitionKey;
  chainKeys?: readonly string[];
};

/** Narrow surface {@link WaitStore} needs from the orchestrator. */
export type WaitStoreHost = {
  nodeStatus(flowId: string, nodeKey: string): Promise<string | null>;
  /** keyed delegate to the transition authority (declared from→to set) */
  setNodeStatus(flowId: string, nodeKey: string, key: TransitionKey, opts?: KeyedTransitionOpts): Promise<boolean>;
  claimNode(flowId: string, nodeKey: string, key: TransitionKey): Promise<string>;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  chainBusy(flowId: string): Promise<boolean>;
  startNodeStage(
    flowId: string,
    nodeKey: string,
    opts?: { rawInput?: unknown; rawPayload?: unknown; resumeWaiting?: boolean; source?: TriggerSource },
  ): Promise<void>;
};

/** Narrow surface {@link StageRunner} needs from the orchestrator. */
export type StageRunnerHost = WaitStoreHost & {
  ctx(flowId: string): Promise<FlowCtx>;
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition>;
  runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string>;
  /** the TriggerGateway claim door (step 06) — the stage-start duplicate fence */
  claimTrigger(params: GatewayClaimParams): Promise<TriggerResult>;
};

/** Narrow surface {@link FlowFactory} needs from the orchestrator. */
export type FlowFactoryHost = {
  start(flowId: string): Promise<void>;
  /** the journal-fenced cancel — the factory's deleteFlow cancels active nodes first */
  cancelNode(flowId: string, nodeKey: string): Promise<void>;
};
