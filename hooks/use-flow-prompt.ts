"use client";
/**
 * The prompt modal's data layer (Phase 2 migration): one node's assembled
 * prompt (`GET /api/flows/:id/prompt`), the context-block selection's
 * final-preview refetch (without re-seeding the editor), and the rules
 * persistence (`POST /api/flows/:id/action` → `set_node_config`, which
 * invalidates the flow's prompt reads so the preview reflects the save).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";

/** Live run-data blocks (context, diffs, logs, comments) — finalized at run time. */
export interface RunDataBlock {
  kind: "rules" | "contract" | "data";
  text: string;
}

/** Context blocks for the picker (scoped refines — what a fresh agent sees). */
export interface ContextBlockInfo {
  id: string;
  label: string;
  description: string;
  /** rendered preview — what the model would see for this block */
  text: string;
  chars: number;
  defaultOn: boolean;
  locked: boolean;
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
  /** exactly what the agent will receive */
  final?: string;
  /** the node config key the rules box saves into (`prompt_rules` / `fix_prompt_rules`) */
  rulesKey?: string;
  /** context blocks for the picker (sub-plan refine prompts, §4/§7.5) */
  contextBlocks?: ContextBlockInfo[];
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
  feedback?: string;
  instructions?: string;
  /** seed a branch-scoped sub-plan refine prompt (?branch=) */
  branch?: string;
  /** show the context block picker (scoped refines) */
  showContextPicker?: boolean;
}

/**
 * All prompt-modal reads + writes for one flow node: the seeded editor
 * state, the base assembled prompt, the selection-scoped preview, and the
 * rules save mutation with its invalidation. The modal renders from this.
 */
export function useFlowPrompt({
  open,
  flowId,
  nodeKey,
  feedback,
  instructions,
  branch,
  showContextPicker,
}: UseFlowPromptInput) {
  const queryClient = useQueryClient();

  // ── editor state (seeded, then user-owned) ──────────────────────────────
  const [edited, setEdited] = useState("");
  const [rules, setRules] = useState("");
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());
  const [rulesSaved, setRulesSaved] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  // ── base read: the assembled prompt for THIS node + seed params ────────
  const seedParams = useMemo(() => {
    const params = new URLSearchParams({ node: nodeKey });
    if (feedback) params.set("feedback", feedback);
    if (instructions) params.set("instructions", instructions);
    if (branch) params.set("branch", branch);
    return params.toString();
  }, [nodeKey, feedback, instructions, branch]);

  const baseQuery = useQuery({
    queryKey: queryKeys.flows.prompt(flowId, `seed:${seedParams}`),
    queryFn: () => fetchPromptData(promptUrl(flowId, seedParams)),
    enabled: open,
  });

  // ── seed the editor once per OPEN session (not per refetch — a focus
  //    refetch must not clobber the user's in-progress edits; only re-open
  //    the modal, i.e. a deliberate re-seed, does) ────────────────────────
  const [openSession, setOpenSession] = useState(0);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) setOpenSession((s) => s + 1);
    wasOpenRef.current = open;
  }, [open]);
  const seedIdentity = `${openSession}:${seedParams}`;
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !baseQuery.data) return;
    if (seededRef.current === seedIdentity) return;
    seededRef.current = seedIdentity;
    setEdited(baseQuery.data.prompt ?? "");
    setRules(baseQuery.data.userRules ?? "");
    const defaults = new Set<string>();
    for (const b of baseQuery.data.contextBlocks ?? []) {
      if (b.defaultOn || b.locked) defaults.add(b.id);
    }
    setSelectedBlocks(defaults);
    setRulesSaved(false);
    setRulesError(null);
  }, [open, baseQuery.data, seedIdentity]);

  // ── preview read: the final prompt must match the picked context blocks —
  //    refetched WITHOUT re-seeding body/rules/picker (that would clobber
  //    the user's edits). While a new selection assembles, the previous
  //    preview keeps showing (placeholderData). ───────────────────────────
  const selectionKey = showContextPicker
    ? [...selectedBlocks].sort().join(",")
    : "";
  const previewParams = useMemo(() => {
    const params = new URLSearchParams({ node: nodeKey });
    if (branch) params.set("branch", branch);
    if (selectionKey) params.set("contextBlocks", selectionKey);
    return params.toString();
  }, [nodeKey, branch, selectionKey]);
  const promptLoaded = !baseQuery.isPending && baseQuery.data != null;
  const previewQuery = useQuery({
    queryKey: queryKeys.flows.prompt(flowId, `preview:${previewParams}`),
    queryFn: () => fetchPromptData(promptUrl(flowId, previewParams)),
    enabled: Boolean(open) && Boolean(showContextPicker) && promptLoaded,
    placeholderData: keepPreviousData,
  });

  // the assembled prompt: base everywhere, with the picker's live sections
  // (final / run data / locked rules) overlaid from the selection-scoped
  // preview once it arrives
  const data = useMemo<PromptData | null>(() => {
    const base = baseQuery.data;
    if (!base) return null;
    const preview = showContextPicker ? previewQuery.data : undefined;
    if (!preview) return base;
    return {
      ...base,
      final: preview.final,
      runData: preview.runData,
      outputContract: preview.outputContract,
      engineRules: preview.engineRules,
    };
  }, [baseQuery.data, previewQuery.data, showContextPicker]);

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
      // refetch so the final preview reflects the saved rules
      void queryClient.invalidateQueries({
        queryKey: queryKeys.flows.promptScope(flowId),
      });
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
    selectedBlocks,
    setSelectedBlocks,
    rulesSaved,
    rulesError,
    setRulesSaved,
    // reads
    data,
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
