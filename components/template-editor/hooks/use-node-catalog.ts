"use client";
/**
 * The palette's catalog data layer (Phase 2 migration): one GET for both
 * the shared node catalog (built-ins + Library) and this template's
 * template-local rows. Fetches only while the palette is open; the catalog
 * epoch is invalidated by the palette (a Save may have created local rows,
 * a promotion may have moved one to the Library — the cache must not
 * outlive either).
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";

/** One /api/node-templates row as the palette renders it. */
export interface NodeCatalogEntry {
  id: string;
  key: string;
  name: string;
  kind: string;
  version: number;
  is_builtin: boolean;
  description: string | null;
  icon: string | null;
  /** owning template — set = template-local (the palette's "This template") */
  template_id?: string | null;
  is_local?: boolean;
}

type NodeCatalogPayload = {
  nodeTemplates?: NodeCatalogEntry[];
  templateNodeTemplates?: NodeCatalogEntry[];
};

export interface NodeCatalog {
  /** shared rows: built-ins + reusable Library entries */
  nodeTemplates: NodeCatalogEntry[];
  /** template-local rows owned by this template */
  templateNodeTemplates: NodeCatalogEntry[];
}

async function fetchNodeCatalog(templateId: string): Promise<NodeCatalog> {
  const res = await fetch(`/api/node-templates?templateId=${encodeURIComponent(templateId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = (await res.json()) as NodeCatalogPayload;
  return {
    nodeTemplates: d.nodeTemplates ?? [],
    templateNodeTemplates: d.templateNodeTemplates ?? [],
  };
}

/**
 * The palette's two catalog sections, fetched together. `enabled` keys off
 * the palette's open state — nothing is fetched while it's collapsed.
 */
export function useNodeCatalog(templateId: string, open: boolean, catalogEpoch?: number) {
  const queryClient = useQueryClient();

  // re-fetch when the host bumps the epoch (post-save / post-promotion):
  // the palette's own cache only — no other catalog consumer exists
  useEffect(() => {
    if (!open || !catalogEpoch) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.templatesCatalog(templateId),
    });
  }, [open, catalogEpoch, templateId, queryClient]);

  return useQuery({
    queryKey: queryKeys.templatesCatalog(templateId),
    queryFn: () => fetchNodeCatalog(templateId),
    enabled: open,
  });
}
