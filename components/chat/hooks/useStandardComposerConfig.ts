import type { useChatComposer } from './useChatComposer';
import type { ComposerConfig } from '../composer-config';

/**
 * The composer config seam's zero-cost default: wraps the chat feature's
 * standard draft/send mechanics (`useChatComposer`) in the same
 * `ComposerConfig` shape a feature builder produces, so `ChatPanel` renders
 * one config path for every node — a feature-built config when provided,
 * this one when not. Lives beside `composer-config.ts`, where the seam is
 * documented: the default config belongs with its type (docs/plan-
 * conversation-refine.md §4d).
 */
export function useStandardComposerConfig(
  /** the standard mechanics, straight from `useChatComposer` */
  standard: ReturnType<typeof useChatComposer>,
  /** the node's display name — the agent-facing placeholder */
  nodeLabel: string
): ComposerConfig {
  return {
    draft: standard.draft,
    onDraftChange: standard.setDraft,
    loading: false,
    error: null,
    sending: standard.sending,
    sendError: standard.sendError,
    sendLabel: 'Send',
    growing: false,
    onSend: draft => standard.send(draft),
    placeholder: `Message the ${nodeLabel} agent…`,
  };
}
