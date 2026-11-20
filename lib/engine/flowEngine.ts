import "server-only";

import { FlowEngine } from "./flowEngine/flowEngine";
import { stepFlows } from "./runtime/fanout/stepFlowManager";
import { splitManager } from "./runtime/split/splitManager";

/** Shared flow engine (decision Q9 — plain module const): composition + delegation only; every collaborator is stateless or DB-fenced, so per-module-graph copies cannot disagree (the `engineParts` precedent). The FlowEngine class lives in `flowEngine/flowEngine.ts` — class files are pure (classFilePurity arch test); this module keeps the pin so the import surface is unchanged. */
export const flowEngine = new FlowEngine();

// plan fan-out: bind the StepFlowManager to the engine — resolves the
// flow ↔ step-flow-manager singleton cycle (step-flow-manager is imported by
// flow-engine.ts for the fan-out hook and cannot import the flowEngine value
// at module scope)
stepFlows.bind(flowEngine);

// split runtime (agent-node split plan §3): same cycle resolution
splitManager.bind(flowEngine);
