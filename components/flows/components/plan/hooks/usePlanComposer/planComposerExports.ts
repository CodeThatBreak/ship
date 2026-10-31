/**
 * The plan composer, split (docs/architecture/plan-unified-turns.md):
 * `usePlanComposer` wires thread state and prompt prefill sources;
 * `usePlanChatAction` owns the chat rail's thread state — the active tab,
 * the per-thread unsent drafts and the imperative draft swaps through the
 * composer's chat ref.
 */
export { usePlanComposer } from "./usePlanComposer";
export { default as usePlanChatAction } from "./hooks/usePlanChatAction";
