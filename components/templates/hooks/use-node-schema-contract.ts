"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type NodeContract,
  type NodeTemplateKind,
  kindContractUrl,
  nodeContractQueryOptions,
} from "@/components/template-editor";

/**
 * The kind's field contract (fields + parsed defaults from the runtime class,
 * via /api/contracts) for the schema-driven DeclarativeConfigFields input —
 * requested per (kind, definition); the request URL is the identity, so
 * refetches ride the shared `queryKeys.nodeContracts` cache the builder
 * drawer uses (its `use-node-contract` — per-instance — shares the same
 * cache key shape). Behavior matches the builder drawer's contract:
 *  - the last good contract keeps rendering while a refetch is in flight
 *    (typing must not unmount the fields);
 *  - a kind switch clears it immediately (a mismatched shape renders the
 *    wrong fields) until the new kind's contract lands;
 *  - a rejected definition (the contract is unparseable for a blank/mid-edit
 *    def) clears it too.
 */
export function useNodeSchemaContract(
  kind: NodeTemplateKind,
  config: Record<string, unknown>,
): NodeContract | null {
  const url = kindContractUrl(kind, config);
  const { data } = useQuery({
    ...nodeContractQueryOptions(url),
    retry: false,
  });

  const [rendered, setRendered] = useState<{
    kind: NodeTemplateKind;
    contract: NodeContract;
  } | null>(null);

  useEffect(() => {
    if (!data) return; // refetch in flight — the last good contract renders on
    setRendered("input" in data ? { kind, contract: data } : null);
  }, [data, kind]);

  // a kind switch is cleared here (until the new contract arrives), while a
  // same-kind definition refetch keeps `rendered`.visible
  return rendered && rendered.kind === kind ? rendered.contract : null;
}
