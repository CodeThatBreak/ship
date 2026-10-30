import { useCallback, useRef, useState } from 'react';

import type { ChatAction, ChatInputHandle } from '@/components/chat';
import { ACTION_TYPES } from '@/components/chat';
import { useFetchAllNodePrompt } from '@/hooks/use-flow-chat';
import useLatest from '@/hooks/utility/useLatest';

import { MAIN_THREAD_CONFIG } from '../../../constants/thread';

/**
 * The plan chat rail's thread-state controller (docs/plan-conversation-refine.md
 * §4d): the plan's side of the chat panel's generic `onAction` seam. It owns
 * the active thread id, the per-thread unsent drafts (a thread switch must
 * never lose a half-written refine — the outgoing thread's draft is stashed on
 * every keystroke and restored when it becomes active again), and the
 * composer's draft change itself, driven imperatively through the exposed
 * `chatInputRef` (the form's `ChatInputHandle`).
 */
type Params = {
  /** the flow id the bulk prompt read (every node's prompt body) is scoped to */
  flowId: string;
};

const usePlanChatAction = ({ flowId }: Params) => {
  // the active thread starts on the main plan tab — the feed filter, the
  // draft stash and the tab highlight all key off the same id from the start
  const [activeThreadId, setActiveThreadId] = useState<string | null>(MAIN_THREAD_CONFIG.id);
  // the switch-time thread id: keystroke actions trail a render, so the draft
  // stash keys off the ref, not the possibly-stale state read
  const latestActiveThreadId = useLatest(activeThreadId);

  /** thread id → the thread's kept draft (the main conversation hides under its tab id) */
  const dirtyThreadRef = useRef<Record<string, string>>({});

  /** the main tab's id — an unset active thread stashes under it */
  const mainThreadId = MAIN_THREAD_CONFIG.id;

  // every promptable node's prompt body in one read — the composer's prefill
  // source (§4a) and the single loading gate its skeleton rides
  const { prompts, isLoading: isPromptsLoading } = useFetchAllNodePrompt(flowId);

  /** the composer's imperative handle — a thread switch changes the draft through it */
  const chatInputRef = useRef<ChatInputHandle | null>(null);

  const onAction = useCallback(
    (action: ChatAction) => {
      switch (action.type) {
        case ACTION_TYPES.THREAD_CHANGED: {
          const threadId = action.payload.threadId;
          setActiveThreadId(threadId);
          // switch the input to the incoming thread's kept draft — a thread
          // never typed in starts empty, like the conversation behind it
          chatInputRef.current?.setDraft(dirtyThreadRef.current[threadId] ?? '');
          return;
        }
        case ACTION_TYPES.DRAFT_CHANGED: {
          const threadId = latestActiveThreadId.current ?? mainThreadId;
          dirtyThreadRef.current[threadId] = action.payload.draft;
          return;
        }
      }
    },
    [latestActiveThreadId, mainThreadId]
  );

  return {
    activeThreadId,
    onAction,
    chatInputRef,
    prompts,
    isPromptsLoading,
  };
};

export default usePlanChatAction;
