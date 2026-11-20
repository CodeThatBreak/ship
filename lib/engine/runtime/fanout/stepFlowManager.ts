import "server-only";

import { StepFlowManager } from "./stepFlowManager/stepFlowManager";

/**
 * Shared application manager pin — bound to the flow engine by flowEngine.ts
 * at load. The StepFlowManager class lives in `stepFlowManager/`; this module
 * keeps the pin so the import surface (`stepFlows`) is unchanged. The bound
 * engine reference is the only in-memory field; all step/child state derives
 * from DB rows, so per-module-graph copies cannot disagree. Class files are
 * pure (classFilePurity arch test), so the instance is pinned here.
 */
export const stepFlows = new StepFlowManager();
