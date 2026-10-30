/**
 * The plan composer, split (docs/plan-conversation-refine.md §4d):
 * `usePlanComposer` owns the send targets (the pending run_node vs the chat
 * conversation); `usePlanChatAction` owns the chat rail's thread state — the
 * active tab, the per-thread unsent drafts and the imperative draft swaps
 * through the composer's chat ref.
 */
export { usePlanComposer } from "./usePlanComposer";
export { default as usePlanChatAction } from "./hooks/usePlanChatAction";
