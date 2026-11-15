import "server-only";

import type { NodeStatus } from "../../db/rows";
import type { FlowCtx, NodeDefinition } from "../nodes/shared/nodeSharedExports";

/** Narrow surface {@link WaitScheduler} needs from the orchestrator. */
export type WaitSchedulerHost = {
  nodeStatus(flowId: string, nodeKey: string): Promise<string | null>;
  setNodeStatus(flowId: string, nodeKey: string, status: string): Promise<void>;
  claimNode(flowId: string, nodeKey: string, from: readonly NodeStatus[]): Promise<string>;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>, clearCurrentKey?: string | null): void;
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
  setCurrentNode(flowId: string, key: string | null): Promise<void>;
  clearCurrentIf(flowId: string, nodeKey: string): Promise<void>;
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
