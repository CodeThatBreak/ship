import "server-only";

import type { StageGateRegistry } from "../staging/stageGateRegistry";
import type { SubflowManager } from "./subflowManager/subflowManager";

/** the gate's registry label (the registry snapshot pins it) */
export const SUBFLOW_STAGE_GATE = "subflow";

/**
 * The subflow runtime's stage-ownership gate registration (task 26, design
 * §7, finding B4): the declarative `subflow` kind's delegation — ONE child
 * flow expanded via the existing `createStepChild` path — registers into the
 * StageGateRegistry at engine boot, AFTER the fan-out and split gates so the
 * frozen registration order (and the snapshot that pins it) only ever
 * extends. The mapping is total: the gate's engagement is `"own"` (the def
 * run is skipped — the rollup publishes the aggregate from the child's
 * terminal), everything else is `"run"`. The expansion claims nothing itself
 * — the stage claim already happened; the rollup owns the follow-on through
 * the registered `onChildTerminal` effect (Invariant 8).
 */
export const registerSubflowStageGate = (registry: StageGateRegistry, subflowFlows: SubflowManager): void => {
  registry.register(SUBFLOW_STAGE_GATE, {
    gate: (flowId, nodeKey) => subflowFlows.gate(flowId, nodeKey),
  });
};
