"use client";
/**
 * Page-local contract reads derived from the editing draft (the template
 * editor route's own views): the decision nodes' labeled branch handles and
 * the start node's run-context fields — the `{{trigger.payload.*}}`
 * vocabulary the configurators offer. The request URL is the identity (the
 * def/kind plus the instance config, which the contract merges over), so the
 * TanStack cache keys make an instance override win over its catalog
 * contract the same way the old per-(node,config) cache did.
 */
import { useMemo, useRef } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import {
  START_NODE_TEMPLATE_ID,
  contractsUrl,
  schemaRows,
  type Draft,
  type NodeContract,
} from "@/components/template-editor";

/** A decision node's branch choice (its labeled out-edge + description). */
export interface BranchChoice {
  label: string;
  description?: string;
  condition?: string;
}

/** A start-node contract field — the {{trigger.payload.*}} vocabulary. */
export interface TriggerField {
  key: string;
  label?: string;
  type?: string;
}

/** GET /api/contracts parsed — null when the request fails. */
export async function fetchContract(
  url: string,
): Promise<NodeContract | null> {
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as NodeContract;
}

function choiceHasLabel(c: unknown): boolean {
  return (
    typeof c === "object" &&
    c !== null &&
    "label" in c &&
    typeof (c as { label: unknown }).label === "string" &&
    (c as { label: string }).label !== ""
  );
}

/** A decision node's own branch choices win over the catalog contract (§4.3). */
function ownChoices(node: Draft["nodes"][number]): BranchChoice[] | null {
  const own = node.config?.choices;
  if (Array.isArray(own) && own.some(choiceHasLabel))
    return own as BranchChoice[];
  return null;
}

export interface InstanceContracts {
  /** decision node key → its labeled branch choices (canvas branch handles) */
  branchChoices: Record<string, BranchChoice[]>;
  /** the start node's contract fields ({{trigger.*}} pickers' vocabulary) */
  triggerFields: TriggerField[];
}

export function useInstanceContracts(draft: Draft | null): InstanceContracts {
  const decisionNodes = useMemo(
    () => (draft ? draft.nodes.filter((n) => n.kind === "decision") : []),
    [draft],
  );
  /** catalog-backed decisions (own overrides don't need a contract read) */
  const pendingDecisions = useMemo(
    () => decisionNodes.filter((n) => ownChoices(n) === null),
    [decisionNodes],
  );

  const contractQueries = useQueries({
    queries: pendingDecisions.map((n) => {
      const url = contractsUrl(n);
      return {
        queryKey: queryKeys.nodeContracts(url),
        queryFn: () => fetchContract(url),
        enabled: draft != null,
        staleTime: 30_000,
        placeholderData: keepPreviousData,
      };
    }),
  });

  /** the live contract choices per decision key, delivered by the queries —
   *  read through a ref so the memo below keys on the signature only */
  const queryChoices = useRef<{ key: string; choices: BranchChoice[] | null }[]>(
    [],
  );
  queryChoices.current = contractQueries.map((q, i) => {
    const choices = pendingDecisions[i] === undefined || q.data == null ? null : q.data.choices ?? [];
    return { key: pendingDecisions[i]?.key ?? "", choices };
  });

  // the memo's dependency-free lookups are refs (see queryChoices above)
  const choiceSig = queryChoices.current
    .map(
      (e) =>
        e.key +
        ":" +
        (e.choices
          ? e.choices
              .map((ch) => `${ch.label}:${ch.condition ?? ""}`)
              .join("·")
          : "none"),
    )
    .join("~");

  const branchChoices = useMemo(() => {
    // choiceSig is this computation's cache key — it changes exactly when the
    // contract choices dereferenced via the ref above do, so re-aggregating
    // (and the canvas's prebuilt node/edge memos) only run on real changes
    void choiceSig;
    const out: Record<string, BranchChoice[]> = {};
    if (!draft) return out;
    for (const n of draft.nodes) {
      if (n.kind !== "decision") continue;
      const own = ownChoices(n);
      if (own) out[n.key] = own;
    }
    for (const e of queryChoices.current) {
      if (e.choices?.length) out[e.key] = e.choices;
    }
    return out;
  }, [draft, choiceSig]);

  // ── the start node's contract fields ({{trigger.*}} vocabulary) ────────────
  const startNode = useMemo(
    () =>
      draft?.nodes.find((n) => n.nodeTemplateId === START_NODE_TEMPLATE_ID) ??
      null,
    [draft],
  );
  const startUrl = startNode ? contractsUrl(startNode) : null;
  const { data: startContract } = useQuery({
    queryKey: queryKeys.nodeContracts(startUrl ?? "none"),
    queryFn: () => fetchContract(startUrl ?? "none"),
    enabled: startUrl != null,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const triggerFields = useMemo<TriggerField[]>(
    () =>
      startContract
        ? schemaRows(startContract.output).map((r) => ({
            key: r.name,
            label: r.description ?? r.name,
            type: r.type,
          }))
        : [],
    [startContract],
  );

  return { branchChoices, triggerFields };
}
