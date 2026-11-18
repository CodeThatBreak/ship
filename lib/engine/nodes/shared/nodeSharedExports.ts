import "server-only";

export { branchNamer, BranchNamer } from "./branchNamer";
export { mrTargetResolver, MrTargetResolver } from "./mrTargetResolver";
export { FlowContextHelper, flowCtxHelper, type ExecMode, type FlowCtx } from "./runContext";
export { NodeSupport } from "./nodeSupport";
// the shared instance is composition-root owned (step 02, decision Q9)
export { nodeSupport } from "../../../composition/container";
export { AgentRunNode } from "./agentRunNode";
export {
  NodeDefinition,
  type ChainRole,
  type NodeTriggerRun,
  type RunOutcome,
} from "./nodeDefinition";
export {
  CHAT_DECLINED,
  nodeRoles,
  NodeRoleRouter,
  PROMPT_SOURCES,
  PROMPT_SOURCE,
  type ChatRefiner,
  type ChatTurnOpts,
  type Converser,
  type NodePromptPreview,
  type PromptPreviewParams,
  type PromptPreviewer,
  type PromptSource,
} from "./nodeRoles";
export {
  DEFAULT_SPLIT_CONSUME,
  SPLIT_CONSUME_MODES,
  SplitTargetError,
  UnitCycleError,
  assertSplitTargetCompatible,
  detectUnitCycle,
  resolveSplitTarget,
  splitConsumeOf,
  splitConsumeSchema,
  splitParallelMaxOf,
  splitParallelMaxSchema,
  type SplitConsumeMode,
  type SplitTarget,
  type SplitTargetLookup,
  type SplitUnit,
} from "./split";
export type { NodeCapabilities } from "./capabilities";
export { TemplateRenderer, type TemplateRenderOptions } from "./templateRenderer";
export { TemplateComposer } from "./templateComposer";
export { extractJson } from "./extractJson";
