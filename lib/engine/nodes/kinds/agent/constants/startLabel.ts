import "server-only";

/**
 * The declarative agent kind's composer send-label for its first (prompt-body)
 * chat turn. Projected to the UI via `capabilities.startLabel` so the chat
 * rail's send button reads "Run agent" instead of the generic "Send".
 */
export const AGENT_START_LABEL = "Run agent";
