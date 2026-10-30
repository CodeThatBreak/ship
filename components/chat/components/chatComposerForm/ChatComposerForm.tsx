'use client';

import { useImperativeHandle, useRef, useCallback, useEffect, type RefObject, useState, type ChangeEvent } from 'react';
import { cn } from '@/lib/utils';

import ModelSelector from '../../ModelSelector';
import { SendButton } from './components/SendButton';
import type { ComposerConfig } from '../../composer-config';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';

import type { ModelChoice } from '@/types/model-spec';
import type { ChatAction } from '../../types/action';

import { ACTION_TYPES } from '../../constants/action';
import { ResetButton } from './components/ResetButton';
import { ChatSkeleton } from './components/ChatSkeleton';

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
  config,
  modelChoice,

  onAction,
  chatInputRef,
}: {
  config: ComposerConfig;
  modelChoice: ModelChoice | null;

  chatInputRef?: RefObject<any>;

  onAction: (action: ChatAction) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [draftState, setDraftState] = useState(config.draft ?? '');
  const [pending, setPending] = useState(false);

  const canSend = config.canSend ?? (draftState.trim().length > 0 && !pending);

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
    [draftState]
  );

  const onReset = useCallback(() => {
    onAction({ type: ACTION_TYPES.RESET });
  }, [onAction]);

  // the growing textarea (prompt/scoped states) previews hundreds of lines;
  // keep its height in step with the content, capped by the ScrollArea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !config.growing) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draftState, config.growing]);

  useImperativeHandle(chatInputRef, () => ({
    focus: (position?: number) => {
      textareaRef.current?.focus();
    },

    setSelectionRange: (start: number, end: number) => {
      textareaRef.current?.setSelectionRange(start, end);
    },
  }));

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

  const onFormSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) return;

    const send = config.onSend(draftState);

    setPending(true);

    Promise.resolve(send)
      .then(() => setDraftState(''))
      .catch(() => {})
      .finally(() => setPending(false));
  }, []);

  const textarea = (
    <InputGroupTextarea
      ref={textareaRef}
      value={draftState}
      onChange={onDraftEdit}
      placeholder={config.placeholder}
      aria-label="Message"
      disabled={pending}
      className={cn('min-h-16', config.growing ? 'py-3' : 'py-2')}
      onKeyDown={onInputKeyDown}
    />
  );

  const canReset = config.reset?.canReset;

  if (config.loading) {
    return <ChatSkeleton />;
  }

  return (
    <form ref={formRef} className="shrink-0 px-3 pb-4 pt-2" onSubmit={onFormSubmit}>
      {(config.caption != null || canReset) && (
        <div className="flex items-center gap-2 px-1 pb-1.5 text-[11px] text-muted-foreground">
          {config.caption}
          <span className="flex-1" />
          {canReset ? <ResetButton onReset={onReset} /> : null}
        </div>
      )}

      {config.error ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-3 text-[11.5px]">
          {config.error}
        </div>
      ) : (
        <InputGroup>
          <ScrollArea className="max-h-[40vh] flex-1 w-full">{textarea}</ScrollArea>
          <InputGroupAddon align="block-end">
            <ModelSelector value={modelChoice} onChange={onModelChange} />
            {config.aside}
            <SendButton sendLabel={config.sendLabel} canSend={canSend} />
          </InputGroupAddon>
        </InputGroup>
      )}
    </form>
  );
}
