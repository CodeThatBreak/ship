'use client';

import { useImperativeHandle, useRef, useEffect, type RefObject, useState, type ChangeEvent } from 'react';
import { ArrowUpIcon, RotateCcwIcon } from 'lucide-react';

import ModelSelector from './ModelSelector';
import type { ComposerConfig } from './composer-config';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ModelChoice } from '@/types/model-spec';
import { ChatAction } from './types/action';

import { ACTION_TYPES } from './constants/action';

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

  // a managed draft (conversation state): local, cleared after an accepted send
  const [managedDraft, setManagedDraft] = useState('');
  const [managedPending, setManagedPending] = useState(false);
  const managed = config.draft === null;
  const draft = config.draft ?? managedDraft;

  const sending = config.sending ?? managedPending;
  const canSend = config.canSend ?? (draft.trim().length > 0 && !sending);

  const onModelChange = (choice: ModelChoice | null) => {
    onAction({ type: ACTION_TYPES.SET_MODEL, payload: { model: choice } });
  };

  const onDraftChange = (next: string) => {
    if (managed) setManagedDraft(next);
    else config.onDraftChange?.(next);
  };

  // the growing textarea (prompt/scoped states) previews hundreds of lines;
  // keep its height in step with the content, capped by the ScrollArea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !config.growing) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft, config.growing]);

  useImperativeHandle(chatInputRef, () => ({
    focus: (position?: number) => {
      textareaRef.current?.focus();
    },

    setSelectionRange: (start: number, end: number) => {
      textareaRef.current?.setSelectionRange(start, end);
    },
  }));

  const onDraftEdit = (event: ChangeEvent<HTMLTextAreaElement>) => onDraftChange(event.target.value);

  // the shared textarea (identical in both the plain and the growing layout)
  const textarea = (
    <InputGroupTextarea
      ref={textareaRef}
      value={draft}
      onChange={onDraftEdit}
      placeholder={config.placeholder}
      aria-label="Message"
      disabled={sending}
      className={cn('min-h-16', config.growing ? 'py-3' : 'py-2')}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          formRef.current?.requestSubmit();
        }
      }}
    />
  );

  return (
    <form
      ref={formRef}
      className="shrink-0 px-3 pb-4 pt-2"
      onSubmit={event => {
        event.preventDefault();
        if (!canSend) return;
        const send = config.onSend(draft);
        if (!managed) return;
        // a managed draft only clears once the server accepted the message
        setManagedPending(true);
        Promise.resolve(send)
          .then(() => setManagedDraft(''))
          .catch(() => {})
          .finally(() => setManagedPending(false));
      }}
    >
      {(config.caption != null || config.reset?.canReset) && (
        <div className="flex items-center gap-2 px-1 pb-1.5 text-[11px] text-muted-foreground">
          {config.caption}
          <span className="flex-1" />
          {config.reset?.canReset && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-5 px-1.5 text-[11px] text-muted-foreground"
              onClick={config.reset.onReset}
            >
              <RotateCcwIcon className="size-3" /> Reset to template
            </Button>
          )}
        </div>
      )}

      {config.loading ? (
        <InputGroup>
          <div role="status" aria-label="Loading the prompt template" className="flex-1 py-3 px-0.5">
            <Skeleton className="h-4 w-11/12 mb-1.5" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </InputGroup>
      ) : config.error ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-3 text-[11.5px]">
          {config.error}
        </div>
      ) : (
        <InputGroup>
          {config.growing ? <ScrollArea className="max-h-[40vh] flex-1 w-full">{textarea}</ScrollArea> : textarea}
          <InputGroupAddon align="block-end">
            <ModelSelector value={modelChoice} onChange={onModelChange} />
            {config.aside}
            <InputGroupButton
              type="submit"
              size="icon-sm"
              className={cn('ml-auto rounded-full', config.sendLabel !== 'Send' && '!w-auto px-3')}
              disabled={!canSend}
              aria-label={config.sendLabel}
            >
              <ArrowUpIcon />
              {config.sendLabel === 'Send' ? (
                <span className="sr-only">Send</span>
              ) : (
                <span className="text-xs font-medium">{config.sendLabel}</span>
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      )}
    </form>
  );
}
