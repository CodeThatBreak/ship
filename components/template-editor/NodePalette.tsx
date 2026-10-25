"use client";
/**
 * The builder's left panel (Phase 5B, restructured): four sections.
 *
 *   Standard      — the built-in SDLC catalog rows (Start · Plan · Build · …);
 *                   picking places an instance of the persisted row.
 *   New node      — Agent / Decision / HTTP / Script rows: each places an
 *                   in-memory draft instance (`nodeTemplateId: "draft:<n>"`
 *                   with its def in the draft's pendingDefs). Nothing is
 *                   created server-side at click time — on Save the row is
 *                   born scoped to THIS template.
 *   This template — the declarative rows created here (template-local:
 *                   node_templates rows owned by this template). Picking
 *                   places an instance of the real row; the side button
 *                   promotes a row to the shared Library (Add to Library).
 *   Library       — collapsed by default: the global declarative rows
 *                   (template_id NULL), reusable across templates. Picking
 *                   places an instance of the real row.
 *
 * Declared nodes are NOT listed here; those live on the canvas and open their
 * configurator from the canvas click. Every placement puts an unconnected node
 * at the viewport center — drag from a node's handle to connect it, then
 * author it in the drawer (the single authoring surface).
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Library, Lock, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/utils";
import type { EditorNode } from "./types";
import { iconForIconName } from "./icons";

type CatalogEntry = {
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
};

type AuthorKind = "agent" | "decision" | "http" | "script";

/** Custom kinds in a fixed display order + their palette group titles. */
const KIND_GROUPS: { kind: AuthorKind; title: string }[] = [
  { kind: "agent", title: "Agent" },
  { kind: "decision", title: "Decision" },
  { kind: "http", title: "HTTP" },
  { kind: "script", title: "Script" },
];

/** Title for the New-node rows (the same text the old kind tiles carried). */
function kindNodeTitle(title: string): string {
  return `Place a blank ${title.toLowerCase()} node — drag from a handle to connect it, then author it in the drawer. Nothing is saved until you Save the template.`;
}

/** Title for the promotion button on "This template" rows. */
const ADD_TO_LIBRARY_TITLE = "Add to Library — reusable in every template";

export interface NodePaletteProps {
  /** the owning template — scopes the catalog fetch (which rows are local) */
  templateId: string;
  /** the template's nodes — used to disable the Start entry once one exists */
  nodes: EditorNode[];
  readonly: boolean;
  /** bumped after a Save that may have created catalog rows (Phase 2) —
   *  the cached catalog is re-fetched so new Library rows show up */
  catalogEpoch?: number;
  /** placing a persisted catalog node on the canvas (unconnected; the host places it) */
  onAddCatalogNode: (rowId: string, isBuiltin: boolean, catalogKey: string, name: string) => void;
  /** a New-node row: place an in-memory draft instance of the kind */
  onAddKindNode: (kind: AuthorKind) => void;
  /** promote a template-local row to the shared Library (the host PATCHes
   *  and bumps the epoch; the promoted row then lists under Library) */
  onAddToLibrary: (rowId: string, name: string) => void;
}

export default function NodePalette({
  templateId,
  nodes,
  readonly,
  catalogEpoch = 0,
  onAddCatalogNode,
  onAddKindNode,
  onAddToLibrary,
}: NodePaletteProps) {
  const [open, setOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  /** template-local rows (the "This template" section) — fetched together
   *  with the shared catalog via `?templateId=` */
  const [localCatalog, setLocalCatalog] = useState<CatalogEntry[] | null>(null);
  /** only one Start node per template — the palette entry locks when it exists */
  const hasStart = nodes.some((n) => n.nodeTemplateId === "nt_start");

  // catalog fetch: on first open, and again whenever the epoch is bumped
  // (a Save may have persisted template-local rows; a promotion may have
  // moved one to the Library — the cache must not outlive either)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/node-templates?templateId=${encodeURIComponent(templateId)}`).then((r) => r.json()).then((d) => {
      if (!alive) return;
      setCatalog(d.nodeTemplates ?? []);
      setLocalCatalog(d.templateNodeTemplates ?? []);
    }).catch(() => {
      if (!alive) return;
      setCatalog([]);
      setLocalCatalog([]);
    });
    return () => {
      alive = false;
    };
  }, [open, catalogEpoch, templateId]);

  if (!open) {
    return (
      <div className="w-11 shrink-0 border-r border-border bg-card flex flex-col items-center py-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={() => setOpen(true)}
          title="Show the node palette"
        >
          <PanelLeftOpen size={16} />
        </Button>
        <div className="text-[9.5px] font-medium text-muted-foreground mt-1.5 [writing-mode:vertical-rl] tracking-wider">
          NODES
        </div>
      </div>
    );
  }

  // built-ins first; Library = global declarative rows, deduped by key
  // (a reused/updated row keeps older versions — only the newest is shown);
  // "This template" = the rows owned by this template, deduped the same way
  const builtins = (catalog ?? []).filter((n) => n.is_builtin);
  const localEntries = newestByKey((localCatalog ?? []).filter((n) => !n.is_builtin));
  const libByKind = KIND_GROUPS.map((g) => ({
    ...g,
    entries: newestByKey((catalog ?? []).filter((n) => !n.is_builtin && n.kind === g.kind)),
  })).filter((g) => g.entries.length > 0);
  const other = newestByKey(
    (catalog ?? []).filter((n) => !n.is_builtin && !KIND_GROUPS.some((g) => g.kind === n.kind)),
  );
  const libraryCount = libByKind.reduce((m, g) => m + g.entries.length, 0) + other.length;
  const localCount = localEntries.length;
  const totalCount = builtins.length + libraryCount + localCount;

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-card flex flex-col min-h-0">
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-border">
        <span className="text-[12.5px] font-semibold">Nodes</span>
        {catalog != null && totalCount > 0 && (
          <Badge variant="outline" className="text-[10px] py-0">{totalCount}</Badge>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          onClick={() => setOpen(false)}
          title="Collapse panel"
        >
          <PanelLeftClose size={15} />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-2">
        {catalog == null && (
          <div className="px-3 py-4"><span className="text-[12px] text-muted-foreground">Loading catalog…</span></div>
        )}
        {catalog != null && builtins.length > 0 && (
          <PaletteGroup title="Standard">
            {builtins.map((n) => {
              const isStart = n.key === "start";
              const locked = isStart && hasStart;
              return (
                <PaletteRow
                  key={n.id}
                  n={n}
                  disabled={readonly || locked}
                  lockTitle={locked ? "Only one Start node per template" : undefined}
                  onPick={() => onAddCatalogNode(n.id, true, n.key, n.name)}
                />
              );
            })}
          </PaletteGroup>
        )}

        {catalog != null && (
          <PaletteGroup title="New node">
            {KIND_GROUPS.map((g) => (
              <KindRow
                key={g.kind}
                kind={g.kind}
                title={g.title}
                disabled={readonly}
                onPick={() => onAddKindNode(g.kind)}
              />
            ))}
          </PaletteGroup>
        )}

        {/* This template: rows created here (template-local declarative rows).
            The side button promotes a saved row to the shared Library. */}
        {catalog != null && (
          <PaletteGroup title="This template">
            {localCount === 0 ? (
              <p className="text-[11px] text-muted-foreground px-2.5 py-1 m-0">
                Nodes you create here live in this template only. Save, then add them to the Library to reuse them across templates.
              </p>
            ) : (
              localEntries.map((n) => (
                <LocalPaletteRow
                  key={n.id}
                  n={n}
                  disabled={readonly}
                  onPick={() => onAddCatalogNode(n.id, false, n.key, n.name)}
                  onAddToLibrary={onAddToLibrary}
                />
              ))
            )}
          </PaletteGroup>
        )}

        {/* Library: persisted custom nodes reusable across templates —
            collapsed by default so the default path stays short */}
        {catalog != null && (
          <div className="px-2 pb-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-1.5 px-1.5 py-1 h-auto text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
              onClick={() => setLibraryOpen((v) => !v)}
            >
              {libraryOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <Library size={11} />
              Library
              {libraryCount > 0 && <span className="normal-case tracking-normal text-[10px]">({libraryCount})</span>}
            </Button>
            {libraryOpen && (
              <div className="grid gap-1 pt-1">
                {libraryCount === 0 && (
                  <p className="text-[11px] text-muted-foreground px-2.5 m-0">
                    Nodes you Save become reusable here, across all templates.
                  </p>
                )}
                {libByKind.map((g) => (
                  <div key={g.kind} className="px-2.5">
                    <div className="text-[10px] text-muted-foreground/80 mb-1">{g.title} nodes</div>
                    <div className="grid gap-1">
                      {g.entries.map((n) => (
                        <PaletteRow key={n.id} n={n} disabled={readonly} onPick={() => onAddCatalogNode(n.id, false, n.key, n.name)} />
                      ))}
                    </div>
                  </div>
                ))}
                {other.length > 0 && (
                  <div className="px-2.5">
                    <div className="text-[10px] text-muted-foreground/80 mb-1">Other</div>
                    <div className="grid gap-1">
                      {other.map((n) => (
                        <PaletteRow key={n.id} n={n} disabled={readonly} onPick={() => onAddCatalogNode(n.id, false, n.key, n.name)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {readonly && (
          <p className="text-[11.5px] text-muted-foreground px-3 py-2 m-0">
            Built-in template is read-only — duplicate it from the gallery to edit.
          </p>
        )}
        </div>
      </ScrollArea>
    </aside>
  );
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

function PaletteGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-2 pb-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1.5 py-1">{title}</div>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

function PaletteRow({ n, disabled, lockTitle, onPick }: { n: CatalogEntry; disabled?: boolean; lockTitle?: string; onPick: () => void }) {
  const Icon = iconForIconName(n.icon, n.is_builtin ? n.key : n.kind, n.key);
  return (
    <button
      onClick={onPick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors",
        disabled
          ? "opacity-50 cursor-not-allowed text-muted-foreground"
          : "hover:bg-muted/60 text-foreground",
      )}
      title={lockTitle ?? (disabled ? "Read-only template — duplicate from the gallery to edit" : `Add ${n.name}`)}
    >
      <Icon size={14} className={cn("shrink-0", n.kind === "decision" ? "text-violet-300" : "text-muted-foreground")} />
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-medium leading-tight truncate">{n.name}</span>
        {n.description && <span className="block text-[10.5px] text-muted-foreground truncate">{n.description}</span>}
      </span>
      {lockTitle ? <Lock size={11} className="text-muted-foreground shrink-0" /> : <Plus size={12} className="text-muted-foreground shrink-0" />}
    </button>
  );
}

/** A New-node row: same shape as a palette row, but it places a draft def
 *  (nothing persists until Save). */
function KindRow({ kind, title, disabled, onPick }: { kind: string; title: string; disabled?: boolean; onPick: () => void }) {
  const Icon = iconForIconName(null, kind);
  return (
    <button
      onClick={onPick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors",
        disabled
          ? "opacity-50 cursor-not-allowed text-muted-foreground"
          : "hover:bg-muted/60 text-foreground",
      )}
      title={kindNodeTitle(title)}
    >
      <Icon size={14} className="shrink-0 text-muted-foreground" />
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-medium leading-tight truncate">{title}</span>
      </span>
      <Plus size={12} className="text-muted-foreground shrink-0" />
    </button>
  );
}

/** A "This template" row: the usual pick row plus the promotion button —
 *  nested buttons are invalid markup, so the row is a flex shell around two
 *  controls (the pick covers icon + label, the ghost button promotes). */
function LocalPaletteRow({
  n,
  disabled,
  onPick,
  onAddToLibrary,
}: {
  n: CatalogEntry;
  disabled?: boolean;
  onPick: () => void;
  onAddToLibrary: (rowId: string, name: string) => void;
}) {
  const Icon = iconForIconName(n.icon, n.is_builtin ? n.key : n.kind, n.key);
  return (
    <div className={cn(
      "flex items-center gap-1 rounded-lg pr-1 min-w-0",
      disabled ? "opacity-50" : "hover:bg-muted/60",
    )}>
      <button
        onClick={onPick}
        disabled={disabled}
        className="flex flex-1 min-w-0 items-center gap-2 px-2.5 py-1.5 text-left"
        title={disabled ? "Read-only template — duplicate from the gallery to edit" : `Add ${n.name}`}
      >
        <Icon size={14} className={cn("shrink-0", n.kind === "decision" ? "text-violet-300" : "text-muted-foreground")} />
        <span className="flex-1 min-w-0">
          <span className="block text-[12.5px] font-medium leading-tight truncate">{n.name}</span>
          {n.description && <span className="block text-[10.5px] text-muted-foreground truncate">{n.description}</span>}
        </span>
        <Plus size={12} className="text-muted-foreground shrink-0" />
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        className="text-muted-foreground hover:text-foreground shrink-0"
        title={ADD_TO_LIBRARY_TITLE}
        onClick={() => onAddToLibrary(n.id, n.name)}
      >
        <Library size={12} />
      </Button>
    </div>
  );
}
