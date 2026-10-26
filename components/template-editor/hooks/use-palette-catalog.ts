"use client";
/**
 * The node palette's catalog data layer: the gated catalog fetch (only while
 * the palette is open, invalidated when the host bumps the epoch), plus the
 * palette's sectioning of the rows — Standard built-ins, New-node kinds, the
 * template's local rows and the shared Library (newest version per key).
 */
import { useState, useMemo } from "react";
import { useNodeCatalog, type NodeCatalogEntry } from "./use-node-catalog";
import type { EditorNode } from "../types";

type CatalogEntry = NodeCatalogEntry;

/** The kinds a New-node row can author. */
export type AuthorKind = "agent" | "decision" | "http" | "script";

/** Custom kinds in a fixed display order + their palette group titles. */
export const KIND_GROUPS: { kind: AuthorKind; title: string }[] = [
  { kind: "agent", title: "Agent" },
  { kind: "decision", title: "Decision" },
  { kind: "http", title: "HTTP" },
  { kind: "script", title: "Script" },
];

/** A Library group: the kind title plus its (deduped) rows. */
export interface LibraryKindGroup {
  kind: AuthorKind;
  title: string;
  entries: CatalogEntry[];
}

/** Collapse version rows of the same key to the newest one (the palette shows
 *  one entry per reusable node, not its version history). */
function newestByKey(entries: CatalogEntry[]): CatalogEntry[] {
  const byKey = new Map<string, CatalogEntry>();
  for (const n of entries) {
    const cur = byKey.get(n.key);
    if (!cur || n.version > cur.version) byKey.set(n.key, n);
  }
  return [...byKey.values()];
}

export function usePaletteCatalog({
  templateId,
  nodes,
  catalogEpoch,
}: {
  /** the owning template — scopes the catalog fetch (which rows are local) */
  templateId: string;
  /** the template's nodes — used to lock the Start entry once one exists */
  nodes: EditorNode[];
  /** bumped after a Save that may have created catalog rows (Phase 2) —
   *  the cached catalog is re-fetched so new Library rows show up */
  catalogEpoch: number;
}) {
  const [open, setOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // catalog fetch: only while the palette is open, and invalidated whenever
  // the host bumps the epoch (a Save may have persisted template-local rows;
  // a promotion may have moved one to the Library — the cache must not
  // outlive either). The hook owns that invalidation.
  const catalogQuery = useNodeCatalog(templateId, open, catalogEpoch);
  /** only one Start node per template — the palette entry locks when it exists */
  const hasStart = nodes.some((n) => n.nodeTemplateId === "nt_start");

  // built-ins first; Library = global declarative rows, deduped by key
  // (a reused/updated row keeps older versions — only the newest is shown);
  // "This template" = the rows owned by this template, deduped the same way
  const { builtins, localEntries, libByKind, other } = useMemo(() => {
    const data = catalogQuery.data;
    return {
      builtins: (data?.nodeTemplates ?? []).filter((n) => n.is_builtin),
      localEntries: newestByKey((data?.templateNodeTemplates ?? []).filter((n) => !n.is_builtin)),
      libByKind: KIND_GROUPS.map((g) => ({
        ...g,
        entries: newestByKey((data?.nodeTemplates ?? []).filter((n) => !n.is_builtin && n.kind === g.kind)),
      })).filter((g) => g.entries.length > 0),
      other: newestByKey(
        (data?.nodeTemplates ?? []).filter((n) => !n.is_builtin && !KIND_GROUPS.some((g) => g.kind === n.kind)),
      ),
    };
  }, [catalogQuery.data]);
  const libraryCount = libByKind.reduce((m, g) => m + g.entries.length, 0) + other.length;
  const localCount = localEntries.length;
  const totalCount = builtins.length + libraryCount + localCount;

  return {
    /** the palette's collapsed rail vs open panel */
    open,
    expand: () => setOpen(true),
    collapse: () => setOpen(false),
    libraryOpen,
    toggleLibrary: () => setLibraryOpen((v) => !v),
    isPending: catalogQuery.isPending,
    isError: catalogQuery.isError,
    refetchCatalog: () => catalogQuery.refetch(),
    /** loaded catalog rows (undefined while pending / errored under no data) */
    catalogData: catalogQuery.data,
    builtins,
    localEntries,
    libByKind,
    other,
    libraryCount,
    localCount,
    totalCount,
    hasStart,
  };
}
