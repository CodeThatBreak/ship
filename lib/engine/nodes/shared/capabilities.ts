import "server-only";

/**
 * The serializable UI capabilities — the shape that crosses the server→client
 * boundary (the flow snapshot / RSC payload / API JSON). It is plain data only
 * so RSC serialization accepts it; the snapshot carries exactly this shape per
 * node. `NodeCapabilities` is the engine-side name for the same shape.
 */
export interface NodeUiCapabilities {
  /**
   * A chat message can regenerate this node's output (the chat panel's
   * refine toggle) — true only when the node's chat handler runs a full
   * refinement.
   */
  refinable?: boolean;
  /**
   * The node's custom conversation mode (docs/plan-conversation-refine.md §4):
   * "plan" = the chat composer IS the node's one input — prefirst-run it
   * carries the prefilled plan body, afterwards it is a conversation whose
   * response contract `{ reply, plan? }` decides whether a message updates
   * the plan. No UI toggle involved; the plan def is the first consumer.
   */
  chatMode?: "plan";
  /**
   * The prompt-route node key the chat's prompt preview / editor targets
   * (set for nodes that publish a user-editable prompt before their first run).
   */
  promptNode?: string;
  /**
   * The composer's send-button label for the node's first run — the body run
   * (e.g. "Run AI review"). Plain "Send" when unset (the refine turn, and
   * nodes without a prompt-body first turn).
   */
  startLabel?: string;
  /** The panel header title; falls back to the node's label. */
  panelTitle?: string;
}

export type NodeCapabilities = NodeUiCapabilities;

/**
 * Project a def's capabilities onto the serializable UI subset for the flow
 * snapshot — a plain object the RSC boundary / `JSON.stringify` can carry.
 * Pure helper (no state), so it stays a function (§3.1).
 */
export function uiCapabilities(
  cap: NodeCapabilities | null | undefined,
): NodeUiCapabilities | null {
  if (!cap) return null;
  return {
    refinable: cap.refinable,
    chatMode: cap.chatMode,
    promptNode: cap.promptNode,
    startLabel: cap.startLabel,
    panelTitle: cap.panelTitle,
  };
}

