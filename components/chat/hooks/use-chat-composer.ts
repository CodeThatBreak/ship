"use client";

import * as React from "react";
import { useSendChatMessage } from "@/hooks/use-flow-chat";
import { composeModelChoice } from "@/lib/modelSpec";
import type { ModelChoice } from "@/types/model-spec";
import type { NodeCapabilities } from "@/types/node-capabilities";

/**
 * The chat composer: draft state, the refine-vs-chat toggle, the send
 * mutation and the derived send-gating state. The input (and its send
 * button) is locked until the run is generated (prompt-publishing nodes
 * only, §3.2).
 */
export function useChatComposer({
  flowId,
  nodeKey,
  capabilities,
  canRefine,
  modelChoice,
  showPromptBox,
}: {
  flowId: string;
  nodeKey: string;
  /** the node contract's UI capabilities (refine/chat/prompt, §3.2) */
  capabilities?: NodeCapabilities | null;
  canRefine: boolean;
  modelChoice: ModelChoice | null;
  /** plan-style nodes, before any output exists: the input is locked */
  showPromptBox: boolean;
}) {
  const [draft, setDraft] = React.useState("");
  // refine-capable node (§3.2 capabilities): does a message regenerate the
  // node's output ("refine"), or just talk? opt-in only — a plain chat
  // message must never kick off a refinement run
  const [refine, setRefine] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  // refinement only makes sense once an output exists
  const refineAvailable = Boolean(capabilities?.refinable) && canRefine;
  const refineOn = refineAvailable && refine;

  // send + refresh: invalidates the transcript key on success (in the hook),
  // surfaces transport/HTTP errors inline; the draft only clears once the
  // server accepted the message
  const sendChat = useSendChatMessage(flowId, nodeKey, {
    chatOnly: capabilities?.chatOnlyMode === "refine" ? !refineOn : false,
    model: composeModelChoice(modelChoice) || undefined,
  });

  const send = (content: string) => {
    const body = content.trim();
    if (!body || sendChat.isPending) return;
    sendChat
      .mutateAsync(body)
      .then(() => setDraft(""))
      .catch(() => {});
  };

  const sending = sendChat.isPending;
  const sendError =
    sendChat.error instanceof Error
      ? sendChat.error
      : sendChat.error != null
        ? new Error(String(sendChat.error))
        : null;

  // nothing to chat with yet — locked with a hint until the run is generated
  const inputLocked = Boolean(showPromptBox);
  const canSend = draft.trim().length > 0 && !sending && !inputLocked;

  return {
    draft,
    setDraft,
    formRef,
    send,
    sending,
    sendError,
    canSend,
    inputLocked,
    refineAvailable,
    refineOn,
    toggleRefine: () => setRefine(!refineOn),
  };
}
