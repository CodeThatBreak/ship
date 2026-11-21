import "server-only";

import type { EngineNodeStatus } from "../../constants/nodeStatus";
import type { NodeDefinition } from "../../nodes/shared/nodeSharedExports";
import type { TransitionKey } from "../../runtime/transitions/types/transitions";
import type { TriggerResult, TriggerSource } from "../../runtime/triggers/types/triggerGateway";

/**
 * The orchestrator surface {@link PanelVerbService} drives — the engine
 * facade's lookups and the gateway's transition door (a deliberate narrow
 * boundary, not a public API; `FlowEngine` implements it).
 */
export interface PanelVerbHost {
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition>;
  /** the node's layered effective config (class ← app ← flow snapshot) */
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  /** the TriggerGateway approval-style door (step 06, Invariant 11) — the
   *  declared row's from-set is the duplicate fence; a lost trigger emits
   *  the typed skip event the route maps to 409 */
  transitionTrigger(params: {
    flowId: string;
    nodeKey: string;
    source: TriggerSource;
    key: TransitionKey;
    toStatus?: EngineNodeStatus;
  }): Promise<TriggerResult>;
}
