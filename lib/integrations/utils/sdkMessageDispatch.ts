import "server-only";

import type { SDKMessage } from "@cursor/sdk";

/** Stream callbacks a run's consumer receives (SDK message shapes). */
export interface StreamCallbacks {
  onStatus?: (s: string) => void;
  onAssistant?: (text: string) => void;
  onThinking?: (text: string) => void;
  onTool?: (
    name: string,
    status: string,
    args?: unknown,
    callId?: string,
    extra?: { result?: unknown; truncated?: unknown },
  ) => void;
}

/**
 * Map one SDKMessage onto the engine's stream callbacks — the single place
 * the SDK's message vocabulary maps onto the engine's event surface. Shared
 * by the in-process cloud pump (`CursorAgentService.pumpRun`) and the
 * per-run local agent host child (`worker/agentHost`), which wraps these
 * callbacks into IPC `event` messages.
 *
 * Pure and dependency-free (SDK types only): the local agent host child
 * imports it directly without pulling any server state along.
 */
export const dispatchSdkMessage = (msg: SDKMessage, cb: StreamCallbacks): void => {
  switch (msg.type) {
    case "assistant":
      for (const block of msg.message.content) {
        if (block.type === "text") cb.onAssistant?.(block.text);
      }
      break;
    case "thinking":
      if (msg.text) cb.onThinking?.(msg.text);
      break;
    case "tool_call":
      cb.onTool?.(msg.name, msg.status, msg.args, msg.call_id, {
        result: msg.result,
        truncated: msg.truncated,
      });
      break;
    case "status":
      cb.onStatus?.(msg.status);
      break;
    default:
      // system / user / task / request / usage — not feed-worthy
      break;
  }
};
