'use client';

'use client';

import {
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  type RefObject,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import ModelSelector from '../../ModelSelector';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SendButton } from './components/SendButton';
import { ResetButton } from './components/ResetButton';
import { ChatSkeleton } from './components/ChatSkeleton';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '@/components/ui/input-group';

import type { ModelChoice } from '@/types/model-spec';
import type { ChatInputHandle } from '../../types';
import type { ChatAction } from '../../types/action';

import { ACTION_TYPES } from '../../constants/action';

/**
 * The chat composer — the config-driven input form (docs/plan-conversation-
 * refine.md §4d): message textarea, model selector, and the optional slots
 * a `ComposerConfig` feature fills (caption/reset/aside, label, growing,
 * loading + error states). Purely presentational — the draft, sends and
 * their errors live in the config builder (the standard mechanics come from
 * the chat panel's `useChatComposer`, plan states from `usePlanComposer`).
 *
 * The controlled draft (`config.draft`) vs composer-managed draft
 * (`config.draft === null`) both end here: a managed draft clears itself
 * once the send promise resolves, so the owner never needs a change-noop.
 */
export default function ChatComposerForm({
  modelChoice,
  draft: initialDraft = '',
  loading,
  caption,
  placeholder,
  sendLabel,
  canReset,
  canSend,
  chatInputRef,
  aside,
  error,
  onSend,
  onAction,
}: {
  modelChoice: ModelChoice | null;
  draft?: string;
  loading: boolean;
  caption?: ReactNode;
  placeholder?: string;
  sendLabel: string;

  canReset: boolean;
  /** explicit send-gating override (e.g. the invalidated scoped chip) */
  canSend?: boolean;

  chatInputRef?: RefObject<ChatInputHandle | null>;

  aside: ReactNode;
  error?: ReactNode;

  /** The send target — a returned promise is the "accepted" signal: the
   *  managed draft clears on its resolution (and keeps the draft while
   *  pending/rejected). */
  onSend?: (draft: string) => void | Promise<unknown>;

  onAction: (action: ChatAction) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [draftState, setDraftState] = useState(initialDraft);
  const [pending, setPending] = useState(false);

  // the send gate: an explicit override stays authoritative; the default gate
  // is a non-empty draft (and no pending send)
  const disableSendButton = (canSend ?? true) && draftState.trim().length > 0 && !pending;

  const onModelChange = useCallback(
    (choice: ModelChoice | null) => {
      onAction({ type: ACTION_TYPES.SET_MODEL, payload: { model: choice } });
    },
    [onAction]
  );

  const onDraftChange = useCallback(
    (next: string) => {
      setDraftState(next);
      onAction({ type: ACTION_TYPES.DRAFT_CHANGED, payload: { draft: next } });
    },
    [onAction]
  );

  const onReset = useCallback(() => {
    onAction({ type: ACTION_TYPES.RESET });
  }, [onAction]);

  useImperativeHandle(
    chatInputRef,
    () => ({
      focus: (position?: number) => {
        textareaRef.current?.focus();
      },

      setSelectionRange: (start: number, end: number) => {
        textareaRef.current?.setSelectionRange(start, end);
      },

      setDraft: (draft: string) => setDraftState(draft),
    }),
    []
  );

  const onInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }, []);

  const onDraftEdit = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => onDraftChange(event.target.value),
    [onDraftChange]
  );

  const onFormSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!onSend || !disableSendButton) return;

      const send = onSend(draftState);

      setPending(true);

      Promise.resolve(send)
        .then(() => {
          // the accepted send clears the draft; the dispatched change keeps
          // the owner's per-thread draft map truthful (the sent draft is gone)
          setDraftState('');
          onAction({ type: ACTION_TYPES.DRAFT_CHANGED, payload: { draft: '' } });
        })
        .catch(() => {})
        .finally(() => setPending(false));
    },
    [onSend, draftState, disableSendButton, onAction]
  );

  const textarea = (
    <InputGroupTextarea
      ref={textareaRef}
      value={draftState}
      onChange={onDraftEdit}
      placeholder={placeholder}
      aria-label="Message"
      disabled={pending}
      className="min-h-16 py-2"
      onKeyDown={onInputKeyDown}
    />
  );

  if (loading) {
    return <ChatSkeleton />;
  }

  return (
    <form ref={formRef} className="shrink-0 px-3 pb-4 pt-2" onSubmit={onFormSubmit}>
      {(caption != null || canReset) && (
        <div className="flex items-center gap-2 px-1 pb-1.5 text-[11px] text-muted-foreground">
          {caption}
          <span className="flex-1" />
          {canReset ? <ResetButton onReset={onReset} /> : null}
        </div>
      )}

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-3 text-[11.5px]">
          {error}
        </div>
      ) : (
        <InputGroup>
          <ScrollArea className="max-h-[40vh] flex-1 w-full">{textarea}</ScrollArea>
          <InputGroupAddon align="block-end">
            <ModelSelector value={modelChoice} onChange={onModelChange} />
            {aside}
            <SendButton sendLabel={sendLabel} canSend={disableSendButton} />
          </InputGroupAddon>
        </InputGroup>
      )}
    </form>
  );
}
