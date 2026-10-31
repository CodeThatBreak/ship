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
 *                   places an instance of the real row. They never leave this
 *                   template — shared reusable nodes are authored on the
 *                   Template Nodes page instead.
 *   Library       — the shared reusable custom nodes, managed on the
 *                   Template Nodes page (/templates/nodes). Picking places
 *                   an instance of the real row.
 *
 * Declared nodes are NOT listed here; those live on the canvas and open their
 * configurator from the canvas click. Every placement puts an unconnected node
 * at the viewport center — drag from a node's handle to connect it, then
 * author it in the drawer (the single authoring surface). The catalog fetch
 * and sectioning live in `hooks/use-palette-catalog`, the rows and sections
 * in `components/`.
 */
import { Badge } from '../../../ui/badge';
import { Button } from '../../../ui/button';
import { ScrollArea } from '../../../ui/scroll-area';
import { RefreshCw, PanelLeftClose } from "lucide-react";
import { KIND_GROUPS, usePaletteCatalog, type AuthorKind } from '../../hooks/usePaletteCatalog';
import { PaletteGroup } from './PaletteGroup';
import { PaletteRow } from './PaletteRow';
import { KindRow } from '../configurator/fields/KindRow';
import { PaletteSkeleton } from './PaletteSkeleton';
import { PaletteLibrary } from './PaletteLibrary';
import { PaletteRail } from './PaletteRail';
import type { EditorNode } from '../../types';

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
}

export default function NodePalette({
  templateId,
  nodes,
  readonly,
  catalogEpoch = 0,
  onAddCatalogNode,
  onAddKindNode,
}: NodePaletteProps) {
  const {
    open,
    expand,
    collapse,
    libraryOpen,
    toggleLibrary,
    isPending,
    isError,
    refetchCatalog,
    catalogData,
    builtins,
    localEntries,
    libByKind,
    other,
    localCount,
    totalCount,
    hasStart,
  } = usePaletteCatalog({ templateId, nodes, catalogEpoch });

  if (!open) {
    return <PaletteRail onOpen={expand} />;
  }

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-card flex flex-col min-h-0">
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-border">
        <span className="text-[12.5px] font-semibold">Nodes</span>
        {!isPending && totalCount > 0 && (
          <Badge variant="outline" className="text-[10px] py-0">{totalCount}</Badge>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          onClick={collapse}
          title="Collapse panel"
        >
          <PanelLeftClose size={15} />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-2">
        {isPending && <PaletteSkeleton />}
        {isError && (
          <div className="px-3 py-4 grid gap-2">
            <p className="text-[12px] text-destructive m-0">
              Couldn&apos;t load the node catalog.
            </p>
            <Button variant="outline" size="sm" className="self-start" onClick={() => void refetchCatalog()}>
              <RefreshCw size={12} /> Retry
            </Button>
          </div>
        )}
        {catalogData != null && builtins.length > 0 && (
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
                  onAdd={onAddCatalogNode}
                />
              );
            })}
          </PaletteGroup>
        )}

        {catalogData != null && (
          <PaletteGroup title="New node">
            {KIND_GROUPS.map((g) => (
              <KindRow
                key={g.kind}
                kind={g.kind}
                title={g.title}
                disabled={readonly}
                onAddKind={onAddKindNode}
              />
            ))}
          </PaletteGroup>
        )}

        {/* This template: rows created here (template-local declarative rows).
            They stay private to this template — shared reusable nodes are
            authored on the Template Nodes page, not promoted from here. */}
        {catalogData != null && (
          <PaletteGroup title="This template">
            {localCount === 0 ? (
              <p className="text-[11px] text-muted-foreground px-2.5 py-1 m-0">
                Nodes you create here live in this template only. Reusable nodes shared across templates are managed on the Template Nodes page.
              </p>
            ) : (
              localEntries.map((n) => (
                <PaletteRow key={n.id} n={n} disabled={readonly} onAdd={onAddCatalogNode} />
              ))
            )}
          </PaletteGroup>
        )}

        {/* Library: the shared reusable nodes, authored on the Template Nodes
            page (/templates/nodes) — collapsed by default so the default path
            stays short */}
        {catalogData != null && (
          <PaletteLibrary
            open={libraryOpen}
            onToggle={toggleLibrary}
            libByKind={libByKind}
            other={other}
            readonly={readonly}
            onAddCatalogNode={onAddCatalogNode}
          />
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
