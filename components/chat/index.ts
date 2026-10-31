/** Public surface of the chat feature — other features go through this barrel. */
export { default as ChatPanel } from "./ChatPanel";
/** The rail's loading skeleton (§2.8) — mirrors the loaded ChatPanel layout. */
export { default as ChatPanelSkeleton } from "./ChatPanelSkeleton";
/** The composer's model picker; consumed by the flow cockpit and settings. */
export { default as ModelSelector } from "./ModelSelector";
export { useModels } from "./hooks/useModels";
export { default as PromptModal } from "./prompt-modal/PromptModal";
/** The composer's config seam (docs/plan-conversation-refine.md §4d). */
export type { ComposerConfig } from "./composer-config";
/** The feed's threads seam (the plan's main plan + per-sub-plan refinement threads). */
export type { ChatTab, ChatInputHandle } from "./types";
/** The composer's action union — SET_MODEL is rail-owned, THREAD_CHANGED feature-owned. */
export type { ChatAction } from './types/action';
export { ACTION_TYPES } from './constants/action';
/** The send seam: feature-owned send targets ride it as one variables object. */
export type { SendMutationFn } from './hooks/useChatComposer';
/** Shared event/option types consumed across features. */
export type { PlanOptions } from "./types";
export type { FeedEvent } from "./timeline";
