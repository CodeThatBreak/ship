import "server-only";

import type { StageGateRegistry } from "../staging/stageGateRegistry";
import type { SplitManager } from "./splitManager/splitManager";

/** the gate's registry label (the registry snapshot pins it) */
export const SPLIT_STAGE_GATE = "split";

/**
 * The split runtime's stage-ownership gate registration (task 24, finding
 * E1): the consumes handoff's decision — the same stage gate the stage
 * runner used to chain literally — registers into the StageGateRegistry at
 * engine boot instead of being called from it. The split manager's boolean
 * maps verbatim: `true` (the expansion ran, the join owns the node) is
 * `"own"`, `false` (the whole path) is `"run"`. The expansion claims through
 * the same gateway as before — only the dispatch indirection moved.
 */
export const registerSplitStageGate = (registry: StageGateRegistry, splitManager: SplitManager): void => {
  registry.register(SPLIT_STAGE_GATE, {
    gate: async (flowId, nodeKey) => ((await splitManager.stageGate(flowId, nodeKey)) ? "own" : "run"),
  });
};
