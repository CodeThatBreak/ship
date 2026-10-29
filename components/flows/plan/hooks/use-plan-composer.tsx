"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCcwIcon, XIcon } from "lucide-react";

import type { ComposerConfig, PlanOptions } from "@/components/chat";
import { PlanOptionToggles } from "@/components/chat";
import {
  useNodeBranchPrompt,
  useNodePrompt,
  useSendChatMessage,
} from "@/hooks/use-flow-chat";
import type { NodeUiCapabilities } from "@/types/node-capabilities";
import { queryKeys } from "@/constants/query-keys";
import { FLOW_STATUS } from "@/constants/flow";
import { Button } from "@/components/ui/button";
import { PLAN_ACTION } from "../constants";
import { usePlanComposerCommand } from "./composer-bus";

/**
 * The plan feature's composer state machine (docs/plan-conversation-
 * refine.md §4a–d): the three composer states — the prefilled plan-template
 * prompt before the first run, the conversation after it, and the scoped
 * branch prefill — expressed as one `ComposerConfig`, with the two template
 * fetches and the three send targets (run_node / chat / refine_plan) living
 * HERE, never in the chat feature's composer hook.
 *
 * There is no mode state: where you are (planPending / the scoped ref) plus
 * whether a plan exists decides what a send does.
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
}: {
  flowId: string;
  nodeKey: string;
  nodeStatus: string | null;
  artifactCount: number;
  capabilities: NodeUiCapabilities | null | undefined;
  planOptions: PlanOptions;
  setPlanOptions: (opts: PlanOptions) => void;
  model: string;
}): ComposerConfig | null {
  const queryClient = useQueryClient();
  // the plan node's prompt-route key (the plan def's promptNode)
  const planKey = capabilities?.promptNode ?? nodeKey;

  // ── where you are: prompt state owns the composer before the first plan ──
  const planPending =
    capabilities?.chatMode === "plan" &&
    artifactCount === 0 &&
    nodeStatus === FLOW_STATUS.PENDING;

  // ── the template fetches (each reads the editable body the composer seeds) ─
  const promptQuery = useNodePrompt(flowId, planKey, { enabled: planPending });
  const [branchRef, setBranchRef] = React.useState<string | null>(null);
  const branchQuery = useNodeBranchPrompt(flowId, planKey, branchRef);

  // the draft state (prompt + scoped states; the conversation draft lives in
  // the composer itself — the config passes null there)
  const [draft, setDraft] = React.useState<string | null>(null);
  const [bumpFocus, setBumpFocus] = React.useState(0);

  // seed the prefilled bodies — once per distinct body, so a refetch never
  // clobbers the developer's in-progress edits
  const promptSeedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const body = promptQuery.data;
    if (!planPending || body == null || promptSeedRef.current === body) return;
    promptSeedRef.current = body;
    setDraft(body);
  }, [planPending, promptQuery.data]);
  const branchSeedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!branchRef || branchQuery.data == null) return;
    if (branchSeedRef.current === branchRef) return;
    branchSeedRef.current = branchRef;
    setDraft(branchQuery.data);
  }, [branchRef, branchQuery.data]);

  // ── the three send targets ───────────────────────────────────────────────
  // action sends (run_node / refine_plan) check the response and refresh the
  // cockpit's snapshot after acceptance, like the cockpit's action callback.
  const lastSendRef = React.useRef<{ kind: "refineBranch"; prompt: string; branchRef: string } | null>(null);
  const actionSend = useMutation({
    mutationFn: async (target: { kind: "runNode" | "refineBranch"; prompt: string; branchRef?: string }) => {
      const res = await fetch(`/api/flows/${flowId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          target.kind === "runNode"
            ? {
                action: "run_node",
                nodeKey,
                input: {
                  prompt: target.prompt,
                  promptIsBody: true,
                  decompose: planOptions.decompose,
                  model: model || null,
                },
              }
            : {
                action: PLAN_ACTION.REFINE,
                prompt: target.prompt,
                promptIsBody: true,
                branchRef: target.branchRef,
                fresh: true,
              },
        ),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      return target;
    },
    onSuccess: (target) => {
      // the action changed flow state — refresh the cockpit's snapshot
      void queryClient.invalidateQueries({ queryKey: queryKeys.flows.detail(flowId) });
      if (target.kind === "runNode") setDraft(null);
      else exitScoped();
    },
  });

  // the conversation send (the follow-up contract surface, §4b)
  const sendChat = useSendChatMessage(flowId, nodeKey, {
    chatOnly: false,
    model: model || undefined,
  });

  const sending = actionSend.isPending || sendChat.isPending;
  const sendError: string | null =
    actionSend.error instanceof Error
      ? actionSend.error.message
      : sendChat.error instanceof Error
        ? sendChat.error.message
        : null;

  // ── the plan panel's commands (focus / scoped prefill) ───────────────────
  // the fresh values the once-registered listener needs
  const planPendingRef = React.useRef(planPending);
  planPendingRef.current = planPending;
  usePlanComposerCommand((command) => {
    if (command.kind === "focusComposer") {
      setBumpFocus(command.at);
      return;
    }
    // the branch refine only exists once plans exist — skip while pending
    if (planPendingRef.current) return;
    actionSend.reset();
    lastSendRef.current = null;
    branchSeedRef.current = null;
    setBranchRef(command.branch);
  });
  const exitScoped = React.useCallback(() => {
    actionSend.reset();
    lastSendRef.current = null;
    branchSeedRef.current = null;
    setBranchRef(null);
    setDraft(null);
  }, [actionSend]);
  const sendBranchRefine = (prompt: string, branch: string) => {
    lastSendRef.current = { kind: "refineBranch", prompt, branchRef: branch };
    void actionSend
      .mutateAsync({ kind: "refineBranch", prompt, branchRef: branch })
      .catch(() => {/* surfaced in the invalidated chip */});
  };

  if (capabilities?.chatMode !== "plan") return null;

  // ── scoped-prefill state (§4c) — a branch card armed the composer ─────────
  if (branchRef != null) {
    const invalidated = branchQuery.isError || (actionSend.isError && lastSendRef.current != null);
    const isPrefillLoading = branchQuery.isPending && draft == null;
    const canSend = (draft ?? "").trim().length > 0 && !sending && !invalidated;
    return {
      draft: isPrefillLoading ? null : draft,
      onDraftChange: setDraft,
      loading: branchQuery.isPending && draft == null,
      error: branchQuery.isError
        ? <PlanComposerErrorBlock
            label={`Branch "${branchRef}" is no longer in the latest plan.`}
            onRetry={() => void branchQuery.refetch()}
            onCancel={exitScoped}
          />
        : null,
      sending,
      canSend,
      sendError: null, // a failed scoped send surfaces in the invalidated chip
      sendLabel: "Refine branch",
      growing: true,
      placeholder: "Edit the scoped refine prompt and send…",
      caption: invalidated
        ? <PlanComposerErrorBlock
            label={`scoped refine: ${branchRef} — invalidated`}
            inline
            onRetry={() =>
              branchQuery.isError
                ? void branchQuery.refetch()
                : sendBranchRefine(
                    (draft ?? lastSendRef.current?.prompt ?? "").trim(),
                    branchRef,
                  )
            }
            onCancel={exitScoped}
          />
        : <span className="flex items-center gap-1.5 min-w-0">
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
          </span>,
      onSend: (next) => sendBranchRefine(next, branchRef),
      focus: bumpFocus,
    };
  }

  // ── prompt state (§4a) — no plan yet: the composer IS the plan prompt ─────
  if (planPending) {
    const templateBody = promptQuery.data ?? "";
    return {
      draft,
      onDraftChange: setDraft,
      loading: promptQuery.isPending && draft == null,
      error: promptQuery.isError
        ? <PlanComposerErrorBlock
            label="Failed to load the plan prompt template."
            onRetry={() => void promptQuery.refetch()}
          />
        : null,
      sending,
      sendError,
      sendLabel: "Generate plan",
      growing: true,
      placeholder: "The plan template is prefilled here — edit it and send.",
      caption: draft != null ? <span>{draft.length.toLocaleString()} chars</span> : null,
      reset: {
        canReset: draft != null && draft !== templateBody,
        onReset: () => setDraft(templateBody),
      },
      aside: <PlanOptionToggles planOptions={planOptions} onChange={setPlanOptions} />,
      onSend: (d) => {
        void actionSend.mutateAsync({ kind: "runNode", prompt: d }).catch(() => {});
      },
      focus: bumpFocus,
    };
  }

  // ── conversation state (§4b) — plans exist: empty draft, the agent decides ─
  return {
    draft: null,
    loading: false,
    error: null,
    sending,
    sendError,
    sendLabel: "Send",
    growing: false,
    placeholder: "Refine the plan or ask anything — the agent decides what to update",
    onSend: (content) => {
      const body = content.trim();
      if (!body || sending) return;
      // the promise reaching the composer is the "accepted" signal — the
      // managed draft clears on it; on failure the form keeps the draft
      return sendChat.mutateAsync(body);
    },
    focus: bumpFocus,
  };
}

/** The composer's inline failure rows (prefill error + the invalidated chip). */
function PlanComposerErrorBlock({
  label,
  onRetry,
  onCancel,
  inline = false,
}: {
  label: string;
  onRetry?: () => void;
  onCancel?: () => void;
  /** inline = the caption row's alert (the invalidated scoped chip) */
  inline?: boolean;
}) {
  return (
    <span
      role="alert"
      className={inline ? "flex flex-1 min-w-0 items-center gap-2" : "flex w-full items-center gap-2"}
    >
      <span className={inline ? "min-w-0 truncate text-warning" : "flex-1 min-w-0 text-destructive"}>
        <RefreshCcwIcon className="mr-1 inline size-3 shrink-0" />
        {label}
      </span>
      {onRetry && (
        <Button type="button" size="xs" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
      {onCancel && (
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </span>
  );
}
