import "server-only";

import type { FlowCtx, NodeDefinition } from "../nodes/shared/nodeSharedExports";
import type { EngineNodeStatus } from "../constants/nodeStatus";
import type { TransitionKey } from "./transitions/types/transitions";

/** The keyed transition opts the engine's wrappers forward to the authority. */
export type KeyedTransitionOpts = {
  toStatus?: EngineNodeStatus;
  patch?: Record<string, unknown>;
  detail?: string;
};

/** Narrow surface {@link WaitScheduler} needs from the orchestrator. */
export type WaitSchedulerHost = {
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
    opts?: { rawInput?: unknown; rawPayload?: unknown; resumeWaiting?: boolean },
  ): Promise<void>;
};

/** Narrow surface {@link EdgeActivator} needs from the orchestrator. */
export type EdgeActivatorHost = WaitSchedulerHost & {
  ctx(flowId: string): Promise<FlowCtx>;
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition>;
  runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string>;
  isStepChild(flowId: string): Promise<boolean>;
  armNodeWait(flowId: string, nodeKey: string, wait: "webhook" | "timer" | "comments", minutes: number | null): Promise<void>;
};

/** Narrow surface {@link FlowFactory} needs from the orchestrator. */
export type FlowFactoryHost = {
  start(flowId: string): Promise<void>;
};


/** Schedule fields folded into the flow read model. */
export type FlowReadScheduleHost = {
  resolveScheduleAt(flowId: string): Promise<number | null>;
};
