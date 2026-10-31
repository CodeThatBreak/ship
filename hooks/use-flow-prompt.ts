"use client";
/**
 * The prompt modal's data layer (Phase 2 migration): one node's assembled
 * prompt (`GET /api/flows/:id/prompt`) and the rules persistence
 * (`POST /api/flows/:id/action` → `set_node_config`, which invalidates the
 * flow's prompt reads so the preview reflects the save).
 *
 * The feedback seeding and the selection-scoped preview refetch (the plan
 * path's context picker) are gone — the plan node's inputs live in the chat
 * composer now (docs/plan-conversation-refine.md §5 #6/#9).
 */
import { invalidateFlowPrompts } from "@/hooks/invalidate-flow-queries";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";

/** Live run-data blocks (context, diffs, logs, comments) — finalized at run time. */
export interface RunDataBlock {
  kind: "rules" | "contract" | "data";
  text: string;
}

/** GET /api/flows/:flowId/prompt — one node's assembled prompt draft. */
export interface PromptData {
  prompt: string;
  label: string;
  description: string;
  variables: string[];
  mode: string;
  source: string;
  /** internal instructions were stripped from `prompt` and are re-appended at run time */
  appendsInternal?: boolean;
  /** where the body came from: the node's config (`prompt_body`) or the built-in default */
  bodySource?: "config" | "default";
  /** the user's standing rules (the config knob named by `rulesKey`) */
  userRules?: string;
  /** engine-authored rules — locked, appended at run time */
  engineRules?: string;
  /** the machine-parsed output contract — locked, appended at run time */
  outputContract?: string;
  /** live run-data blocks (context, diffs, logs, comments) — finalized at run time */
  runData?: RunDataBlock[];
  /** everything after the editable body in `final` (rules + ordered locked blocks) */
  finalTail?: string;
  /** what the agent receives for the SAVED body — the modal overlays live edits on it */
  final?: string;
  /** the node config key the rules box saves into (`prompt_rules` / `fix_prompt_rules`) */
  rulesKey?: string;
}

const promptUrl = (flowId: string, params: string) =>
  `/api/flows/${flowId}/prompt?${params}`;

async function fetchPromptData(url: string): Promise<PromptData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PromptData;
}

export interface UseFlowPromptInput {
  open: boolean;
  flowId: string;
  nodeKey: string;
  /** extra developer instructions (review focus, resolve instructions, pipeline guidance) */
  instructions?: string;
}

/**
 * All prompt-modal reads + writes for one flow node: the seeded editor
 * state, the base assembled prompt, and the rules save mutation with its
 * invalidation. The modal renders from this.
 */
export function useFlowPrompt({
  open,
  flowId,
  nodeKey,
  instructions,
}: UseFlowPromptInput) {
  const queryClient = useQueryClient();

  const seedParams = new URLSearchParams({ node: nodeKey });
  if (instructions) seedParams.set("instructions", instructions);

  const baseQuery = useQuery({
    queryKey: queryKeys.flows.prompt(flowId, `seed:${seedParams}`),
    queryFn: () => fetchPromptData(promptUrl(flowId, seedParams.toString())),
    enabled: open,
  });

  // ── editor overrides (null = follow the base query through refetches) ───
  const [editedOverride, setEditedOverride] = useState<string | null>(null);
  const [rulesOverride, setRulesOverride] = useState<string | null>(null);
  const [rulesSaved, setRulesSaved] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  const baseBody = baseQuery.data?.prompt ?? "";
  const baseRules = baseQuery.data?.userRules ?? "";
  const edited = editedOverride ?? baseBody;
  const rules = rulesOverride ?? baseRules;

  const setEdited = (next: string) => setEditedOverride(next);
  const setRules = (next: string) => setRulesOverride(next);

  // ── reset overrides when the modal is opened anew ───────────────────────
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setEditedOverride(null);
      setRulesOverride(null);
      setRulesSaved(false);
      setRulesError(null);
    }
    wasOpenRef.current = open;
  }, [open]);

  // The server's `final` is assembled from the SAVED body; the modal runs the
  // body the user is editing. Rebuild it from the live body + the server's
  // tail (rules and ordered locked blocks) so the preview matches the run.
  const finalPrompt = (() => {
    if (!baseQuery.data) return undefined;
    const data: PromptData = baseQuery.data;
    if (data.source === "override") return data.final;
    // fall back to stripping the saved body when an older payload has no tail
    const tail =
      data.finalTail ??
      (data.final?.startsWith(data.prompt)
        ? data.final.slice(data.prompt.length).replace(/^\n\n/, "")
        : undefined);
    if (tail == null) return data.final;
    return [edited.trim(), tail].filter(Boolean).join("\n\n");
  })();

  // ── rules save (a network mutation): persists the node's config knob so
  //    every later run assembles the same prompt ──────────────────────────
  const rulesSaveMutation = useMutation({
    mutationFn: async ({ rules, rulesKey }: { rules: string; rulesKey?: string }) => {
      const res = await fetch(`/api/flows/${flowId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_node_config",
          nodeKey,
          config: { [rulesKey ?? "prompt_rules"]: rules.trim() || null },
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      setRulesSaved(true);
      setRulesError(null);
      setRulesOverride(null);
      void invalidateFlowPrompts(queryClient, flowId);
    },
    onError: (e: unknown) => setRulesError(e instanceof Error ? e.message : String(e)),
  });

  return {
    // editor state
    edited,
    setEdited,
    rules,
    setRules,
    promptTextareaRef,
    rulesSaved,
    rulesError,
    setRulesSaved,
    // reads
    data: baseQuery.data ?? null,
    finalPrompt,
    // the UI's "unsaved" check + reset initialize off the base body
    baseData: baseQuery.data ?? null,
    seedPending: baseQuery.isPending,
    seedError: baseQuery.isError,
    refetch: () => void baseQuery.refetch(),
    // rules save
    savingRules: rulesSaveMutation.isPending,
    saveRules: rulesSaveMutation.mutate,
  };
}
