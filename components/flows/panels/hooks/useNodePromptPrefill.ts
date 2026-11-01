"use client";
import { useNodePrompt } from "@/hooks/useFlowChat";
import { errorMessageOf } from "@/hooks/fetchJson";
import { FLOW_STATUS } from "@/constants/flow";
import { useNodePanel } from "../context";

/**
 * The shared first-run predicate with the engine's `AgentRunNode.isFirstTurn`
 * (docs/make-agentic-node-consistent.md Phase 2): a node that never published
 * an output and sits pending or failed is awaiting its first run — its next
 * chat turn carries the prompt body, not refine feedback. A failed node with
 * an output falls back to refine turns.
 */
export function isNodeFirstRun(node: {
  output?: Record<string, unknown> | null;
  status: string;
}): boolean {
  return (
    node.output == null &&
    (node.status === FLOW_STATUS.PENDING || node.status === FLOW_STATUS.FAILED)
  );
}

/**
 * The standard chat rail's composer prefill (Composer-as-Prompt, the plan
 * node's mode generalized): a promptable node — its def capabilities say so —
 * awaiting its first run prefills the composer with the node's full prompt
 * body (the send label becomes the run's start action); once the node has
 * run, no prefill and the standard refine send apply. Everything is gated off
 * the capabilities — no node-key checks. A failed prompt read surfaces a
 * retry instead of silently seeding an empty, sendable draft.
 */
export function useNodePromptPrefill(): {
  /** the node is promptable and awaits its first run */
  firstRun: boolean;
  /** the prompt body to seed the composer with (null while unavailable) */
  prefill: string | null;
  /** the first-run prompt read is still loading (the rail shows the skeleton) */
  isLoading: boolean;
  /** the first-run prompt read failed — the composer's error slot shows it */
  error: string | null;
  retry: () => void;
} {
  const { flow, node } = useNodePanel();

  const promptKey: string | null = node.capabilities?.promptNode ?? null;
  const firstRun = promptKey != null && isNodeFirstRun(node);

  const promptQuery = useNodePrompt(flow.id, promptKey ?? node.node_key, {
    // only a first-run prefill reads the prompt; refine turns define their own body
    enabled: promptKey != null && firstRun,
  });

  return {
    firstRun,
    prefill: promptQuery.data ?? null,
    isLoading: promptQuery.isLoading,
    error: firstRun ? errorMessageOf(promptQuery.error) : null,
    retry: () => {
      void promptQuery.refetch();
    },
  };
}
