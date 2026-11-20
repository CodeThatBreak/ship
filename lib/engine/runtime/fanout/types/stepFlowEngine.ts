import "server-only";

import type { Prisma } from "@prisma/client";
import type { ChainRole, FlowCtx } from "../../../nodes/shared/nodeSharedExports";
import type { NodeCapabilities } from "../../../nodes/shared/capabilities";
import type { TemplateGraph } from "../../../templates/templateStore";
import type { TransitionKey } from "../../transitions/types/transitions";
import type { TriggerResult } from "../../triggers/types/triggerGateway";
import type { StepChildPayload } from "./stepChildPayload";

/**
 * The engine surface the fan-out runtime drives — bound once by the
 * `StepFlowManager` facade (flowEngine's module tail resolves the
 * flow ↔ fan-out singleton cycle: flowEngine imports the manager for the
 * fan-out hook, so the manager can never import the flowEngine value at
 * module scope).
 *
 * Structural subset of `FlowEngine` — the fan-out classes see exactly these
 * members and nothing else. The aggregate publish (`StepRollup.finishFanout`)
 * reads the trigger type through `graph`, advances the edges through
 * `advanceFrom` and heartbeats the flow through `touch`.
 */
export type StepFlowEngine = {
  ctx(flowId: string): Promise<FlowCtx>;
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  defOf(flowId: string, nodeKey: string): Promise<{ key: string; label: string; capabilities: NodeCapabilities }>;
  createStepChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: StepChildPayload,
    opts: { branch: string | null },
    tx?: Prisma.TransactionClient
  ): Promise<string>;
  startStepChild(childFlowId: string): Promise<void>;
  cancelNode(flowId: string, nodeKey: string): Promise<void>;
  setNodeStatus(flowId: string, nodeKey: string, key: TransitionKey): Promise<boolean>;
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void;
  /** run a node with a validated rawInput (the Phase-2 merge-fix agent drives
   *  the step child's runNode-with-feedback path, exactly like the SDLC
   *  chain's commit-fix reuses runNode for push rejections) */
  runNode(flowId: string, nodeKey: string, rawInput: unknown): Promise<string>;
  /** the latest artifact version a chain role's def published as a
   *  first-class resource (§T3/F3) — the plan version the mode resolution
   *  reads, scoped through the plan def's metadata instead of a literal kind */
  latestResourceArtifact<T>(flowId: string, role: ChainRole, columns?: string): Promise<T | undefined>;
  /** typed lifecycle emission (step 07: the gate's shadowed-knob trail event) */
  emitLifecycle(flowId: string, nodeKey: string | null, message: string, data?: Record<string, unknown>): Promise<void>;
  /** the flow's template graph — the aggregate publish reads the node's
   *  trigger type from it (approval ⇒ `awaiting_approval` terminal) */
  graph(flowId: string): Promise<TemplateGraph | null>;
  /** the normal edge evaluation after a success-terminal aggregate publish */
  advanceFrom(flowId: string, nodeKey: string): Promise<void>;
  /** flows.updated_at heartbeat */
  touch(flowId: string): Promise<void>;
  /** the build approval (the step-card approve routes into the child flow's approve) */
  approvals: { approveBuild(flowId: string, branchName?: string): Promise<TriggerResult> };
  /** the retry service's node retry (the step-card retry drives the child's failed node) */
  retries: { retryNode(flowId: string, nodeKey: string): Promise<TriggerResult> };
};
