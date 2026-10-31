import "server-only";

import type { NodeStatus } from "../../db/rows";
import type { FlowCtx, NodeDefinition } from "../nodes/shared/nodeSharedExports";

/** Narrow surface {@link WaitScheduler} needs from the orchestrator. */
export type WaitSchedulerHost = {
  nodeStatus(flowId: string, nodeKey: string): string;
  setNodeStatus(flowId: string, nodeKey: string, status: string): void;
  claimNode(flowId: string, nodeKey: string, from: readonly NodeStatus[]): string;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>, clearCurrentKey?: string | null): void;
  nodeConfigFor(flowId: string, nodeKey: string): Record<string, unknown>;
  chainBusy(flowId: string): boolean;
  startNodeStage(
    flowId: string,
    nodeKey: string,
    opts?: { rawInput?: unknown; rawPayload?: unknown; resumeWaiting?: boolean },
  ): Promise<void>;
};

/** Narrow surface {@link EdgeActivator} needs from the orchestrator. */
export type EdgeActivatorHost = WaitSchedulerHost & {
  ctx(flowId: string): FlowCtx;
  defOf(flowId: string, nodeKey: string): NodeDefinition;
  runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string>;
  setCurrentNode(flowId: string, key: string | null): void;
  clearCurrentIf(flowId: string, nodeKey: string): void;
  isStepChild(flowId: string): boolean;
  armNodeWait(flowId: string, nodeKey: string, wait: "webhook" | "timer" | "comments", minutes: number | null): void;
};

/** Narrow surface {@link FlowFactory} needs from the orchestrator. */
export type FlowFactoryHost = {
  start(flowId: string): void;
};


/** Schedule fields folded into the flow read model. */
export type FlowReadScheduleHost = {
  resolveScheduleAt(flowId: string): number | null;
};
