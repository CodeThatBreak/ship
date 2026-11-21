import "server-only";

import type { StageGateRegistry } from "../staging/stageGateRegistry";
import type { StepFlowManager } from "./stepFlowManager/stepFlowManager";

/** the gate's registry label (the registry snapshot pins it) */
export const FANOUT_STAGE_GATE = "fanout";

/**
 * The plan fan-out runtime's stage-ownership gate registration (task 24,
 * finding E1): the fan-out knob's decision — the same gate/expansion the
 * stage runner used to chain literally — registers into the StageGateRegistry
 * at engine boot instead of being called from it. The mapping preserves
 * today's chain byte-for-byte: `"fanout"` expands the child flows and owns
 * the node (`"own"`), `"whole-wrap"` runs the def's normal whole path and
 * wraps the native output as the single-entry aggregate afterwards
 * (`{ run, afterRun }`), and the frozen whole default (`null`) is `"run"`.
 * The expansion claims through the same gateway as before — only the
 * dispatch indirection moved.
 */
export const registerFanoutStageGate = (registry: StageGateRegistry, stepFlows: StepFlowManager): void => {
  registry.register(FANOUT_STAGE_GATE, {
    gate: async (flowId, nodeKey) => {
      const fanout = await stepFlows.gate(flowId, nodeKey);
      if (fanout === "fanout") {
        await stepFlows.expand(flowId, nodeKey);
        return "own";
      }
      if (fanout === "whole-wrap") {
        return { run: true, afterRun: () => stepFlows.wrapWholeOutput(flowId, nodeKey) };
      }
      return "run";
    },
  });
};
