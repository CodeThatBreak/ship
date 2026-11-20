import "server-only";

export { branchNamer } from "./branchNamer";
export { BranchNamer } from "./branchNamer/branchNamer";
export { mrTargetResolver } from "./mrTargetResolver";
export { MrTargetResolver } from "./mrTargetResolver/mrTargetResolver";
export { flowCtxHelper } from "./runContext";
export { FlowContextHelper } from "./runContext/flowContextHelper";
export type { ExecMode, FlowCtx } from "./runContext/types/flowContext";
export { NodeSupport } from "./nodeSupport";
// the shared instance is composition-root owned (step 02, decision Q9)
export { nodeSupport } from "../../../composition/container";
export { AgentRunNode } from "./agentRunNode";
export { NodeDefinition } from "./nodeDefinition";
export type { ChainRole } from "./types/chainRole";
export type { NodeTriggerRun } from "./types/nodeTriggerRun";
export type { RunOutcome } from "./types/runOutcome";
export { nodeRoles } from "./nodeRoles";
export { NodeRoleRouter } from "./nodeRoles/nodeRoleRouter";
export { CHAT_DECLINED } from "./constants/chatDeclined";
export { PROMPT_SOURCES, PROMPT_SOURCE, type PromptSource } from "./constants/promptSource";
export type {
  ChatRefiner,
  ChatTurnOpts,
  Converser,
  NodePromptPreview,
  PromptPreviewParams,
  PromptPreviewer,
} from "./nodeRoles/types/nodeRoles";
export {
  DEFAULT_SPLIT_CONSUME,
  SPLIT_CONSUME_MODES,
  assertSplitTargetCompatible,
  detectUnitCycle,
  resolveSplitTarget,
  splitConsumeOf,
  splitParallelMaxOf,
  type SplitConsumeMode,
  type SplitTarget,
  type SplitTargetLookup,
  type SplitUnit,
} from "./split";
export { SplitTargetError } from "./split/splitTargetError";
export { UnitCycleError } from "./split/unitCycleError";
export { splitConsumeSchema, splitParallelMaxSchema } from "./split/schemas/splitKnobs";
export type { NodeCapabilities } from "./capabilities";
export { TemplateRenderer } from "./templateRenderer";
export type { TemplateRenderOptions } from "./types/templateRenderer";
export { TemplateComposer } from "./templateComposer";
export { extractJson } from "./extractJson";
