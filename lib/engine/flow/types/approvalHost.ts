import "server-only";

import type { ChainRole, FlowCtx, NodeDefinition } from "../../nodes/shared/nodeSharedExports";
import type { EngineNodeStatus } from "../../constants/nodeStatus";
import type { TransitionKey } from "../../runtime/transitions/types/transitions";

/**
 * The orchestrator surface {@link FlowApprovalService} drives — the engine
 * facade's keyed transition wrappers, lookups and release hooks (a deliberate
 * narrow boundary, not a public API; `FlowEngine` implements it).
 */
export interface ApprovalHost {
  keyOfRole(flowId: string, role: ChainRole): Promise<string | null>;
  nodeStatus(flowId: string, nodeKey: string): Promise<string | null>;
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition>;
  graph(flowId: string): Promise<{ edges: { kind: string; from: string; to: string }[]; byKey: Map<string, { trigger: { type: string } }> } | null>;
  ctx(flowId: string): Promise<FlowCtx>;
  isStepChild(flowId: string): Promise<boolean>;
  latestResourceArtifact<T>(flowId: string, role: ChainRole, columns?: string): Promise<T | undefined>;
  /** the engine's keyed transition wrapper (delegates to the authority) */
  setNodeStatus(
    flowId: string,
    nodeKey: string,
    key: TransitionKey,
    opts?: { toStatus?: EngineNodeStatus; patch?: Record<string, unknown>; detail?: string },
  ): Promise<boolean>;
  /** the SDLC builtin chain's build approval (MR creation lives there) */
  sdlcApproveBuild(flowId: string, branchName?: string): Promise<void>;
  emitLifecycle(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void>;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  advanceFrom(flowId: string, fromKey: string): Promise<void>;
}
