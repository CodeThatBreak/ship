"use client";
import { useMemo } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import {
  START_NODE_TEMPLATE_ID,
  contractsUrl,
  nodeContractQueryOptions,
  schemaRows,
  type Draft,
} from "@/components/template-editor";

export interface BranchChoice {
  label: string;
  description?: string;
  condition?: string;
}

export interface TriggerField {
  key: string;
  label?: string;
  type?: string;
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

function ownChoices(node: Draft["nodes"][number]): BranchChoice[] | null {
  const own = node.config?.choices;
  if (Array.isArray(own) && own.some(choiceHasLabel))
    return own as BranchChoice[];
  return null;
}

export interface InstanceContracts {
  branchChoices: Record<string, BranchChoice[]>;
  triggerFields: TriggerField[];
}

export const useInstanceContracts = (draft: Draft | null): InstanceContracts => {
  const decisionNodes = useMemo(
    () => (draft ? draft.nodes.filter((n) => n.kind === "decision") : []),
    [draft],
  );
  const pendingDecisions = useMemo(
    () => decisionNodes.filter((n) => ownChoices(n) === null),
    [decisionNodes],
  );

  const contractQueries = useQueries({
    queries: pendingDecisions.map((n) => {
      const url = contractsUrl(n);
      return {
        ...nodeContractQueryOptions(url),
        enabled: draft != null,
        placeholderData: keepPreviousData,
      };
    }),
  });

  const queryChoices = useMemo(
    () =>
      contractQueries.map((q, i) => {
        const choices =
          pendingDecisions[i] === undefined || q.data == null
            ? null
            : (q.data.choices ?? []);
        return { key: pendingDecisions[i]?.key ?? "", choices };
      }),
    [contractQueries, pendingDecisions],
  );

  const branchChoices = useMemo(() => {
    const out: Record<string, BranchChoice[]> = {};
    if (!draft) return out;
    for (const n of draft.nodes) {
      if (n.kind !== "decision") continue;
      const own = ownChoices(n);
      if (own) out[n.key] = own;
    }
    for (const e of queryChoices) {
      if (e.choices?.length) out[e.key] = e.choices;
    }
    return out;
  }, [draft, queryChoices]);

  const startNode = useMemo(
    () =>
      draft?.nodes.find((n) => n.nodeTemplateId === START_NODE_TEMPLATE_ID) ??
      null,
    [draft],
  );
  const startUrl = startNode ? contractsUrl(startNode) : null;
  const { data: startContract } = useQuery({
    ...nodeContractQueryOptions(startUrl ?? "none"),
    enabled: startUrl != null,
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
};
