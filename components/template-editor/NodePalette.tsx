"use client";
/**
 * The builder's left panel (Phase 5B): a collapsible "Add node" palette. The
 * node_templates catalog is grouped by category — built-in SDLC nodes, then
 * your custom nodes by declarative kind — and clicking an entry places it on
 * the canvas (auto-connected from the flow's Start node). Declared nodes are
 * NOT listed here; those live on the canvas and open their configurator from
 * the canvas click. The custom-kind buttons add a node of that kind directly —
 * one click creates a ready-to-edit instance whose prompt/knobs are authored
 * in the drawer *after* connecting, so the upstream run context is available
 * as clickable variables; the old pre-placement authoring dialog stays one
 * click away for authors who want schema validation before placing.
 */
import { useEffect, useState } from "react";
import { Lock, PanelLeftClose, PanelLeftOpen, Plus, Wand2 } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import type { EditorNode } from "./types";
import { iconForIconName } from "./icons";

type CatalogEntry = {
  id: string;
  key: string;
  name: string;
  kind: string;
  is_builtin: boolean;
  description: string | null;
  icon: string | null;
};

type AuthorKind = "agent" | "decision" | "http" | "script";

/** Custom kinds in a fixed display order + their palette group titles. */
const KIND_GROUPS: { kind: AuthorKind; title: string }[] = [
  { kind: "agent", title: "Agent nodes" },
  { kind: "decision", title: "Decision nodes" },
  { kind: "http", title: "HTTP nodes" },
  { kind: "script", title: "Script nodes" },
];

export interface NodePaletteProps {
  /** the template's nodes — used to disable the Start entry once one exists */
  nodes: EditorNode[];
  readonly: boolean;
  /** an authoring request is in flight (node creation busy state) */
  busy?: boolean;
  /** placing a catalog node on the canvas (auto-connected by the host) */
  onAddCatalogNode: (rowId: string, isBuiltin: boolean, catalogKey: string, name: string) => void;
  /** one-click add: a blank node of the kind, created + placed + drawer opened */
  onAddKindNode: (kind: AuthorKind) => void;
  /** opens the pre-placement authoring dialog at a declarative kind */
  onOpenAuthoring: (kind: AuthorKind) => void;
}

export default function NodePalette({
  nodes,
  readonly,
  busy,
  onAddCatalogNode,
  onAddKindNode,
  onOpenAuthoring,
}: NodePaletteProps) {
  const [open, setOpen] = useState(true);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  /** only one Start node per template — the palette entry locks when it exists */
  const hasStart = nodes.some((n) => n.nodeTemplateId === "nt_start");

  useEffect(() => {
    if (!open || catalog) return;
    fetch("/api/node-templates").then((r) => r.json()).then((d) => setCatalog(d.nodeTemplates ?? [])).catch(() => setCatalog([]));
  }, [open, catalog]);

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
          ADD NODE
        </div>
      </div>
    );
  }

  // groups: built-ins first, then declarative kinds in fixed order
  const builtins = (catalog ?? []).filter((n) => n.is_builtin);
  const byKind = KIND_GROUPS.map((g) => ({ ...g, entries: (catalog ?? []).filter((n) => !n.is_builtin && n.kind === g.kind) }));
  const other = (catalog ?? []).filter((n) => !n.is_builtin && !KIND_GROUPS.some((g) => g.kind === n.kind));

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-card flex flex-col min-h-0">
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-border">
        <span className="text-[12.5px] font-semibold">Add node</span>
        <Badge variant="outline" className="text-[10px] py-0">{catalog?.length ?? "…"}</Badge>
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

      <div className="flex-1 overflow-y-auto min-h-0 py-2">
        {catalog == null && (
          <div className="px-3 py-4"><span className="text-[12px] text-muted-foreground">Loading catalog…</span></div>
        )}
        {catalog != null && builtins.length > 0 && (
          <PaletteGroup title="Built-in SDLC nodes">
            {builtins.map((n) => {
              const isStart = n.key === "start";
              const locked = isStart && hasStart;
              return (
                <PaletteRow
                  key={n.id}
                  n={n}
                  disabled={readonly || busy || locked}
                  lockTitle={locked ? "Only one Start node per template" : undefined}
                  onPick={() => onAddCatalogNode(n.id, true, n.key, n.name)}
                />
              );
            })}
          </PaletteGroup>
        )}
        {catalog != null && byKind.some((g) => g.entries.length > 0) && (
          <PaletteGroup title="Your custom nodes">
            {byKind.filter((g) => g.entries.length > 0).map((g) => (
              <div key={g.kind} className="px-2.5 pb-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{g.title}</div>
                <div className="grid gap-1">
                  {g.entries.map((n) => (
                    <PaletteRow key={n.id} n={n} disabled={readonly || busy} onPick={() => onAddCatalogNode(n.id, false, n.key, n.name)} />
                  ))}
                </div>
              </div>
            ))}
          </PaletteGroup>
        )}
        {catalog != null && other.length > 0 && (
          <PaletteGroup title="Other">
            {other.map((n) => (
              <PaletteRow key={n.id} n={n} disabled={readonly || busy} onPick={() => onAddCatalogNode(n.id, false, n.key, n.name)} />
            ))}
          </PaletteGroup>
        )}
        {readonly && (
          <p className="text-[11.5px] text-muted-foreground px-3 py-2 m-0">
            Built-in template is read-only — duplicate it from the gallery to edit.
          </p>
        )}
      </div>

      {/* one-click custom-node add: a blank instance of the kind, configured
          in the drawer after it's connected (upstream variables become chips) */}
      <div className="shrink-0 border-t border-border p-2 grid gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground px-1">Add custom node</span>
        <div className="grid grid-cols-2 gap-1">
          {KIND_GROUPS.map((g) => (
            <Button
              key={g.kind}
              variant="outline"
              size="sm"
              disabled={readonly || busy}
              onClick={() => onAddKindNode(g.kind)}
              title={`Add a blank ${g.kind} node — connect it, then author its prompt in the drawer (upstream variables clickable)`}
              className="capitalize gap-1 text-[12px]"
            >
              <Plus size={11} /> {g.kind}
            </Button>
          ))}
        </div>
        <button
          className="text-[11px] text-muted-foreground hover:text-foreground px-1 pt-0.5 text-left flex items-center gap-1 disabled:opacity-50"
          disabled={readonly || busy}
          onClick={() => onOpenAuthoring("agent")}
        >
          <Wand2 size={11} /> Author with the full form…
        </button>
      </div>
    </aside>
  );
}

function PaletteGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-2 pb-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2.5 py-1">{title}</div>
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
