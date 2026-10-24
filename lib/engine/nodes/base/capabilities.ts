/**
 * Node capabilities (pristine plan §3.2): what the UI may do with a node,
 * declared on the node definition — the same contract the engine runs from.
 * The flow detail payload surfaces them per node, and the chat panel keys its
 * behavior off them instead of node-key checks.
 */
export interface NodeCapabilities {
  /**
   * A chat message can regenerate this node's output (the chat panel's
   * refine toggle) — true only when the node's chat handler runs a full
   * refinement.
   */
  refinable?: boolean;
  /**
   * How plain chat messages are treated: "refine" = the message regenerates
   * the output when the toggle is on, chat-only otherwise; "followup" =
   * every message is a follow-up on the node's agent.
   */
  chatOnlyMode?: "refine" | "followup";
  /**
   * The prompt-route node key the chat's prompt preview / editor targets
   * (set for nodes that publish a user-editable prompt before their first run).
   */
  promptNode?: string;
  /** The panel header title; falls back to the node's label. */
  panelTitle?: string;
}
