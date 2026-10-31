"use client";
/**
 * The builder's header bar: back link (guarded by the confirm dialog), the
 * template title + version/built-in badges, node/edge counts and the layout
 * autosave/"unsaved" annotations, then the flow-settings/undo/redo/save
 * actions (hidden while a read-only built-in is open).
 */
import { ArrowLeft, LayoutTemplate, Lock, Redo2, Save, Settings2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { LayoutSync } from "@/components/templateEditor/hooks/useNodePositions";

export interface EditorHeaderProps {
  template: {
    id: string;
    name: string;
    version: number;
    is_builtin: boolean;
  };
  nodeCount: number;
  edgeCount: number;
  readonly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  saving: boolean;
  layoutSync: LayoutSync;
  onBack: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenSettings: () => void;
  onSave: () => void;
}

export function EditorHeader({
  template,
  nodeCount,
  edgeCount,
  readonly,
  canUndo,
  canRedo,
  dirty,
  saving,
  layoutSync,
  onBack,
  onUndo,
  onRedo,
  onOpenSettings,
  onSave,
}: EditorHeaderProps) {
  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-border bg-card">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-1.5 gap-1.5 text-muted-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-3.5" /> Templates
      </Button>
      <LayoutTemplate size={17} className="text-muted-foreground" />
      <div className="min-w-0">
        <h1 className="text-[14.5px] font-semibold m-0 leading-tight flex items-center gap-2 truncate">
          {template.name}
          {readonly ? (
            <Badge className="bg-info/10 text-info">
              <Lock size={9} className="mr-0.5" />
              built-in
            </Badge>
          ) : null}
          <Badge variant="outline" className="text-[10px]">
            v{template.version}
          </Badge>
        </h1>
        <p className="text-muted-foreground text-[11px] m-0">
          {nodeCount} node{nodeCount === 1 ? "" : "s"} · {edgeCount} edge
          {edgeCount === 1 ? "" : "s"}
          {(layoutSync === "pending" || layoutSync === "saved" || layoutSync === "error") && (
            <span>
              {" "}
              ·{" "}
              {layoutSync === "pending"
                ? "saving layout…"
                : layoutSync === "saved"
                  ? "layout autosaved"
                  : (
                    <span className="text-destructive">layout save failed</span>
                  )}
            </span>
          )}
          {dirty && (
            <span className="text-warning"> · graph has unsaved changes</span>
          )}
        </p>
      </div>
      <div className="flex-1" />
      {readonly ? (
        <span className="text-[11.5px] text-muted-foreground flex items-center gap-1.5">
          <Lock size={11} /> read-only —{" "}
          <button
            type="button"
            className="underline"
            onClick={onBack}
          >
            duplicate in the gallery
          </button>{" "}
          to edit
        </span>
      ) : null}
      {!readonly && (
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          <Settings2 size={13} /> Flow settings
        </Button>
      )}
      {!readonly && (
        <>
          <Button variant="ghost" size="icon-sm" disabled={!canUndo} title="Undo (⌘Z)" onClick={onUndo}>
            <Undo2 size={14} />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={!canRedo} title="Redo (⇧⌘Z)" onClick={onRedo}>
            <Redo2 size={14} />
          </Button>
        </>
      )}
      {!readonly && (
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
          {saving ? <Spinner /> : <Save size={13} />} Save{dirty ? "" : "d"}
        </Button>
      )}
    </header>
  );
}
