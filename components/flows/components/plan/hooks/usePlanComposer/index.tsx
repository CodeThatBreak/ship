'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { XIcon } from 'lucide-react';

import type { ComposerConfig, PlanOptions, ChatTabs } from '@/components/chat';
import { PlanOptionToggles } from '@/components/chat';
import { errorMessageOf, postJson } from '@/hooks/fetch-json';
import { useNodeBranchPrompt, useNodePrompt, useSendChatMessage } from '@/hooks/use-flow-chat';
import type { NodeUiCapabilities } from '@/types/node-capabilities';
import { queryKeys } from '@/constants/query-keys';
import { FLOW_ACTION, FLOW_STATUS } from '@/constants/flow';
import { ACTION_TYPES } from '../../constants/action';
import { PlanComposerErrorBlock } from '../../components/PlanComposerErrorBlock';

/** The chat panel's main plan tab — the unthreaded whole-plan conversation. */
const MAIN_PLAN_TAB = 'Main plan';

/** A plan tab's feed empty state — one refinement conversation per tab (§4b). */
const REFINE_HINT = "This sub-plan's refinement conversation — refine it further or ask about its steps.";

/** A composer send against the flow's action route (run_node / refine_plan). */
type PlanActionTarget =
  | { kind: 'runNode'; prompt: string }
  | { kind: 'refineBranch'; prompt: string; branchRef: string };

/** RefineBranchTarget = A scoped refine send, remembered for the chip's retry. */
type RefineBranchTarget = Extract<PlanActionTarget, { kind: 'refineBranch' }>;

/**
 * The plan feature's composer state machine (docs/plan-conversation-refine.md
 * §4a–d): the three composer states — the prefilled plan-template prompt
 * before the first run, the conversation after it, and the scoped branch
 * prefill — expressed as one `ComposerConfig`, with the two template fetches
 * and the three send targets (run_node / chat / refine_plan) living HERE,
 * never in the chat feature's composer hook.
 *
 * There is no mode state: where you are (planPending / the scoped ref) plus
 * whether a plan exists decides what a send does.
 *
 * The hook also owns the chat panel's conversation tabs (the `tabs` seam):
 * the feature supplies the full list — the main plan tab plus one tab per
 * sub plan branch — and the active tab id; ChatPanel renders them as the
 * generic shared TabStrip. A scoped prefill (§4c) switches the chat to that
 * sub plan's tab and a send from a tab rides its thread.
 */
export function usePlanComposer({
  flowId,
  nodeKey,
  nodeStatus,
  artifactCount,
  capabilities,
  planOptions,
  setPlanOptions,
  model,
  branchNames,
}: {
  flowId: string;
  nodeKey: string;
  nodeStatus: string | null;
  artifactCount: number;
  capabilities: NodeUiCapabilities | null | undefined;
  planOptions: PlanOptions;
  setPlanOptions: (opts: PlanOptions) => void;
  model: string;
  /** the latest plan's branch names — one conversation tab per sub plan */
  branchNames: string[];
}): { composer: ComposerConfig | null; tabs: ChatTabs | null } {
  const queryClient = useQueryClient();
  // the plan node's prompt-route key (the plan def's promptNode)
  const planKey = capabilities?.promptNode ?? nodeKey;

  // ── where you are: prompt state owns the composer before the first plan ──
  const planPending = capabilities?.chatMode === 'plan' && artifactCount === 0 && nodeStatus === FLOW_STATUS.PENDING;

  // ── the template fetches (each reads the editable body the composer seeds) ─
  const promptQuery = useNodePrompt(flowId, planKey, { enabled: planPending });
  const [branchRef, setBranchRef] = useState<string | null>(null);
  const branchQuery = useNodeBranchPrompt(flowId, planKey, branchRef);

  // the active chat tab (the chat panel's tabs seam): the main plan tab
  // (id null) is the default; a scoped prefill (§4c) arms its branch's tab;
  // conversation sends from a tab ride its thread. The node picked in the
  // graph has no tabs → reset to the main plan tab.
  const [thread, setThread] = useState<string | null>(null);
  useEffect(() => {
    setThread(null);
  }, [nodeKey]);

  // the draft state (prompt + scoped states; the conversation draft lives in
  // the composer itself — the config passes null there)
  const [draft, setDraft] = useState<string | null>(null);
  const [bumpFocus, setBumpFocus] = useState(0);

  // seed the prefilled bodies — once per distinct body, so a refetch never
  // clobbers the developer's in-progress edits
  const promptSeedRef = useRef<string | null>(null);
  useEffect(() => {
    const body = promptQuery.data;
    if (!planPending || body == null || promptSeedRef.current === body) return;
    promptSeedRef.current = body;
    setDraft(body);
  }, [planPending, promptQuery.data]);
  const branchSeedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!branchRef || branchQuery.data == null) return;
    if (branchSeedRef.current === branchRef) return;
    branchSeedRef.current = branchRef;
    setDraft(branchQuery.data);
  }, [branchRef, branchQuery.data]);

  // ── the three send targets ───────────────────────────────────────────────
  // action sends (run_node / refine_plan) ride the shared POST transport and
  // refresh the cockpit's snapshot after acceptance, like the cockpit's
  // action callback.
  const lastSendRef = useRef<RefineBranchTarget | null>(null);

  const actionSend = useMutation({
    mutationFn: async (target: PlanActionTarget) => {
      await postJson(
        `/api/flows/${flowId}/action`,
        JSON.stringify(
          target.kind === 'runNode'
            ? {
                action: FLOW_ACTION.RUN_NODE,
                nodeKey,
                input: {
                  prompt: target.prompt,
                  promptIsBody: true,
                  decompose: planOptions.decompose,
                  model: model || null,
                },
              }
            : {
                action: ACTION_TYPES.REFINE,
                prompt: target.prompt,
                promptIsBody: true,
                branchRef: target.branchRef,
                fresh: true,
              }
        )
      );
      return target;
    },
    onSuccess: target => {
      // the action changed flow state — refresh the cockpit's snapshot
      void queryClient.invalidateQueries({ queryKey: queryKeys.flows.detail(flowId) });
      if (target.kind === 'runNode') setDraft(null);
      else exitScoped();
    },
  });

  // the conversation send (the follow-up contract surface, §4b): a send from
  // the active thread's tab rides that thread (`null` = the main conversation)
  const sendChat = useSendChatMessage(flowId, nodeKey, {
    chatOnly: false,
    model: model || undefined,
    thread,
  });

  const sending = actionSend.isPending || sendChat.isPending;
  const sendError: string | null = errorMessageOf(actionSend.error) ?? errorMessageOf(sendChat.error);

  const exitScoped = useCallback(() => {
    actionSend.reset();
    lastSendRef.current = null;
    branchSeedRef.current = null;
    setBranchRef(null);
    setThread(null);
    setDraft(null);
  }, [actionSend]);
  const sendBranchRefine = (prompt: string, branch: string) => {
    lastSendRef.current = { kind: 'refineBranch', prompt, branchRef: branch };
    void actionSend.mutateAsync({ kind: 'refineBranch', prompt, branchRef: branch }).catch(() => {
      /* surfaced in the invalidated chip */
    });
  };

  // ── the chat panel's refinement tabs (the tabs seam) — built before the
  // returns so hooks stay unconditional: the feature supplies the full list —
  // the MAIN PLAN TAB (the unthreaded main conversation, id null) plus one
  // tab per sub plan branch
  const tabs: ChatTabs = useMemo(
    () => ({
      items: [
        // the main plan tab carries the same refine copy as the branch tabs —
        // the panel's active-tab lookup matches the null-id item, so the main
        // tab's empty feed already rendered this copy before the seam carried it
        {
          id: null,
          label: MAIN_PLAN_TAB,
          emptyTitle: `Refine the “${MAIN_PLAN_TAB}” sub-plan`,
          emptyDescription: REFINE_HINT,
        },
        ...branchNames.map(name => ({
          id: name,
          label: name,
          emptyTitle: `Refine the “${name}” sub-plan`,
          emptyDescription: REFINE_HINT,
        })),
      ],
      active: thread,
      onActive: setThread,
    }),
    [branchNames, thread]
  );

  if (capabilities?.chatMode !== 'plan') return { composer: null, tabs: null };

  // ── scoped-prefill state (§4c) — a branch card armed the composer ─────────
  if (branchRef != null) {
    // the prefill failed (HTTP error, or the route answered without a body)
    const prefillFailed = branchQuery.isError || (branchQuery.isFetched && branchQuery.data == null);
    const invalidated = prefillFailed || (actionSend.isError && lastSendRef.current != null);
    const isPrefillLoading = branchQuery.isPending;
    const canSend = (draft ?? '').trim().length > 0 && !sending && !invalidated;
    return {
      composer: {
        draft: isPrefillLoading ? null : draft,
        onDraftChange: setDraft,
        loading: isPrefillLoading,
        error: prefillFailed ? (
          <PlanComposerErrorBlock
            label={
              branchQuery.isError
                ? `Branch "${branchRef}" is no longer in the latest plan.`
                : `Failed to load the branch "${branchRef}" prompt.`
            }
            onRetry={() => void branchQuery.refetch()}
            onCancel={exitScoped}
          />
        ) : null,
        sending,
        canSend,
        sendError: null, // a failed scoped send surfaces in the invalidated chip
        sendLabel: 'Refine branch',
        growing: true,
        placeholder: 'Edit the scoped refine prompt and send…',
        caption: invalidated ? (
          <PlanComposerErrorBlock
            label={`scoped refine: ${branchRef} — invalidated`}
            inline
            onRetry={() =>
              prefillFailed
                ? void branchQuery.refetch()
                : sendBranchRefine((draft ?? lastSendRef.current?.prompt ?? '').trim(), branchRef)
            }
            onCancel={exitScoped}
          />
        ) : (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="min-w-0 truncate">
              scoped refine: <span className="font-medium text-info">{branchRef}</span>
            </span>
            <button
              type="button"
              aria-label="Cancel scoped refine"
              className="text-muted-foreground hover:text-foreground"
              onClick={exitScoped}
            >
              <XIcon className="size-3 shrink-0" />
            </button>
          </span>
        ),
        onSend: next => sendBranchRefine(next, branchRef),
        focus: bumpFocus,
      },
      tabs,
    };
  }

  // ── prompt state (§4a) — no plan yet: the composer IS the plan prompt ─────
  if (planPending) {
    // the template is gone (HTTP error, or the route answered without one)
    const promptFailed = promptQuery.isError || (promptQuery.isFetched && promptQuery.data == null);
    const templateBody = promptQuery.data ?? '';
    return {
      composer: {
        draft,
        onDraftChange: setDraft,
        loading: promptQuery.isPending && draft == null,
        error: promptFailed ? (
          <PlanComposerErrorBlock
            label="Failed to load the plan prompt template."
            onRetry={() => void promptQuery.refetch()}
          />
        ) : null,
        sending,
        sendError,
        sendLabel: 'Generate plan',
        growing: true,
        placeholder: 'The plan template is prefilled here — edit it and send.',
        caption: draft != null ? <span>{draft.length.toLocaleString()} chars</span> : null,
        reset: {
          canReset: draft != null && draft !== templateBody,
          onReset: () => setDraft(templateBody),
        },
        aside: <PlanOptionToggles planOptions={planOptions} onChange={setPlanOptions} />,
        onSend: d => {
          void actionSend.mutateAsync({ kind: 'runNode', prompt: d }).catch(() => {});
        },
        focus: bumpFocus,
      },
      tabs,
    };
  }

  // ── conversation state (§4b) — plans exist: empty draft, the agent decides ─
  return {
    composer: {
      draft: null,
      loading: false,
      error: null,
      sending,
      sendError,
      sendLabel: 'Send',
      growing: false,
      placeholder: thread
        ? `Refine the “${thread}” sub-plan or ask anything — the agent decides what to update`
        : 'Refine the plan or ask anything — the agent decides what to update',
      onSend: content => {
        const body = content.trim();
        if (!body || sending) return;
        // the promise reaching the composer is the "accepted" signal — the
        // managed draft clears on it; on failure the form keeps the draft
        return sendChat.mutateAsync(body);
      },
      focus: bumpFocus,
    },
    tabs,
  };
}
