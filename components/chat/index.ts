/** Public surface of the chat feature — other features go through this barrel. */
export { default as ChatPanel } from "./ChatPanel";
/** The composer's model picker; consumed by the flow cockpit and settings. */
export { default as ModelSelector, useModels } from "./ModelSelector";
export { default as PromptModal, type PromptRunExtras } from "./prompt-modal/PromptModal";
/** Shared event/option types consumed across features. */
export type { PlanOptions, PlanStartOpts } from "./types";
export type { FeedEvent } from "./timeline";
