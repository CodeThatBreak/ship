/**
 * The palette's Library section (the shared reusable nodes, authored on the
 * Template Nodes page (/templates/nodes) — collapsed by default so the
 * default path stays short). Rows group by authoring kind; leftover kinds
 * land under "Other".
 */
import Link from "next/link";
import { ChevronDown, ChevronRight, Library } from "lucide-react";
import { Button } from '../../../ui/button';
import type { NodeCatalogEntry } from '../../hooks/useNodeCatalog';
import type { LibraryKindGroup } from '../../hooks/usePaletteCatalog';
import { PaletteRow } from "./PaletteRow";

export function PaletteLibrary({
  open,
  onToggle,
  libByKind,
  other,
  readonly,
  onAddCatalogNode,
}: {
  open: boolean;
  onToggle: () => void;
  libByKind: LibraryKindGroup[];
  /** Library rows whose kind isn't one of the grouped author kinds */
  other: NodeCatalogEntry[];
  readonly: boolean;
  /** placing a persisted catalog node on the canvas (unconnected; the host places it) */
  onAddCatalogNode: (rowId: string, isBuiltin: boolean, catalogKey: string, name: string) => void;
}) {
  const libraryCount = libByKind.reduce((m, g) => m + g.entries.length, 0) + other.length;
  return (
    <div className="px-2 pb-2">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-1.5 px-1.5 py-1 h-auto text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        onClick={onToggle}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Library size={11} />
        Library
        {libraryCount > 0 && <span className="normal-case tracking-normal text-[10px]">({libraryCount})</span>}
      </Button>
      {open && (
        <div className="grid gap-1 pt-1">
          {libraryCount === 0 && (
            <p className="text-[11px] text-muted-foreground px-2.5 m-0">
              Reusable nodes are managed on the{" "}
              <Link href="/templates/nodes" className="underline hover:text-foreground">
                Template Nodes
              </Link>{" "}
              page.
            </p>
          )}
          {libByKind.map((g) => (
            <div key={g.kind} className="px-2.5">
              <div className="text-[10px] text-muted-foreground/80 mb-1">{g.title} nodes</div>
              <div className="grid gap-1">
                {g.entries.map((n) => (
                  <PaletteRow key={n.id} n={n} disabled={readonly} onAdd={onAddCatalogNode} />
                ))}
              </div>
            </div>
          ))}
          {other.length > 0 && (
            <div className="px-2.5">
              <div className="text-[10px] text-muted-foreground/80 mb-1">Other</div>
              <div className="grid gap-1">
                {other.map((n) => (
                  <PaletteRow key={n.id} n={n} disabled={readonly} onAdd={onAddCatalogNode} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
