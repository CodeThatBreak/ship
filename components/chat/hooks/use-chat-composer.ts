"use client";

import * as React from "react";
import { useSendChatMessage } from "@/hooks/use-flow-chat";
import { composeModelChoice } from "@/lib/modelSpec";
import type { ModelChoice } from "@/types/model-spec";

/**
 * The standard chat composer's mechanics: draft state, the send mutation and
 * the derived send-gating state. The plan node bypasses this hook entirely —
 * its three composer states and send targets live in the plan feature's
 * `usePlanComposer` (docs/plan-conversation-refine.md §4d), so this hook
 * never grows plan logic.
 */
export function useChatComposer({
  flowId,
  nodeKey,
  modelChoice,
}: {
  flowId: string;
  nodeKey: string;
  modelChoice: ModelChoice | null;
}) {
  const [draft, setDraft] = React.useState("");

  // send + refresh: invalidates the transcript key on success (in the hook),
  // surfaces transport/HTTP errors inline; the draft only clears once the
  // server accepted the message. A plain chat message's effect is decided by
  // the node's response contract — the UI never declares intent.
  const sendChat = useSendChatMessage(flowId, nodeKey, {
    chatOnly: false,
    model: composeModelChoice(modelChoice) || undefined,
  });

  const sending = sendChat.isPending;
  const sendError =
    sendChat.error instanceof Error
      ? sendChat.error
      : sendChat.error != null
        ? new Error(String(sendChat.error))
        : null;
  const canSend = draft.trim().length > 0 && !sending;

  const send = (content: string) => {
    const body = content.trim();
    if (!body || sendChat.isPending) return;
    sendChat
      .mutateAsync(body)
      .then(() => setDraft(""))
      .catch(() => {});
  };

  return {
    draft,
    setDraft,
    send,
    sending,
    sendError,
    canSend,
  };
}
