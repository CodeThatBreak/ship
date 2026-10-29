/** Public surface of the chat feature — other features go through this barrel. */
export { default as ChatPanel } from "./ChatPanel";
/** The composer's model picker; consumed by the flow cockpit and settings. */
export { default as ModelSelector, useModels } from "./ModelSelector";
export { default as PromptModal } from "./prompt-modal/PromptModal";
/** The decompose toggle (the plan composer's prompt-state aside). */
export { default as PlanOptionToggles } from "./PlanOptionToggles";
/** The composer's config seam (docs/plan-conversation-refine.md §4d). */
export type { ComposerConfig } from "./composer-config";
/** The feed's threads seam (the plan's per-refinement chat tabs). */
export type { ChatTab, ChatTabs } from "./types";
/** Shared event/option types consumed across features. */
export type { PlanOptions } from "./types";
export type { FeedEvent } from "./timeline";
