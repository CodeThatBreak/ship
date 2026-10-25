"use client";
/**
 * The template gallery (§8). Phase 6 convergence:
 *  - "New template" creates an *Untitled flow* instantly and opens the editor —
 *    no name dialog speed bump (the name lives in the editor's Flow settings);
 *  - delete asks through the styled AlertDialog (no native confirm());
 *  - "Your templates" renders only when non-empty, with an inline hint when
 *    the list is empty but starters exist;
 *  - import takes a file (upload or drag-drop) or paste, shows validation
 *    problems inside the dialog, and has an explicit Cancel;
 *  - starters' open action is labeled "Preview" (they're read-only).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Copy,
  Download,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  is_builtin: number;
  trigger: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  nodeCount: number;
};

/** One gallery row card — shared between the starter and user-template lists. */
function TemplateRowCard({
  t, busyId, onOpen, onDuplicate, onDelete,
}: {
  t: TemplateRow;
  busyId: string | null;
  onOpen: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  const builtin = Boolean(t.is_builtin);
  return (
    <Card className="p-0 gap-0 shadow-sm! overflow-hidden">
      <div className="px-4 py-3.5 flex items-start gap-3">
        <span className="size-9 shrink-0 grid place-items-center rounded-lg bg-muted">
          <Workflow size={16} className="text-muted-foreground" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/templates/${t.id}`} className="font-medium text-[13.5px] hover:underline">
              {t.name}
            </Link>
            {builtin && (
              <Badge className="bg-info/10 text-info">built-in</Badge>
            )}
            {Boolean(t.trigger?.type === "manual") || <Badge>{String(t.trigger?.type ?? "manual")}</Badge>}
            <Badge variant="outline">{t.nodeCount} node{t.nodeCount === 1 ? "" : "s"}</Badge>
          </div>
          {t.description && (
            <p className="text-[12.5px] text-muted-foreground mt-1 mb-0">{t.description}</p>
          )}
        </div>
        <div className="flex gap-1.5 items-center">
          <Button size="sm" variant="outline" onClick={onOpen}>
            {builtin ? "Preview" : "Open"}
          </Button>
          {onDuplicate && (
            <Button size="sm" variant="ghost" onClick={onDuplicate} disabled={busyId === t.id} title="Duplicate">
              {busyId === t.id ? <Spinner /> : <Copy size={13} />}
            </Button>
          )}
          <a href={`/api/templates/${t.id}/export`} title="Export YAML">
            <Button size="sm" variant="ghost">
              <Download size={13} />
            </Button>
          </a>
          {onDelete && (
            <Button size="sm" variant="ghost" onClick={onDelete} disabled={busyId === t.id} title="Delete">
              <Trash2 size={13} />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function TemplateGallery() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [yamlText, setYamlText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  /** the template behind the styled delete confirm (was the native confirm) */
  const [pendingDelete, setPendingDelete] = useState<TemplateRow | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/templates").then((r) => r.json()).catch(() => null);
    if (r?.templates) setTemplates(r.templates);
    else setError("failed to load templates");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** A1: "New template" creates an *Untitled flow* instantly and opens the
   *  editor — the name is edited in the editor's Flow settings, not here. */
  const create = async () => {
    setBusyId("__new");
    const r = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    setBusyId(null);
    if (r.error) {
      setError(r.error);
      return;
    }
    if (r.id) router.push(`/templates/${r.id}`);
  };

  /** Duplicate = export YAML + import (exercises the round-trip path). */
  const duplicate = async (t: TemplateRow) => {
    setBusyId(t.id);
    try {
      const yaml = await fetch(`/api/templates/${t.id}/export`).then((r) => r.text());
      const created = await fetch("/api/templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml, namePrefix: "Copy" }),
      }).then((r) => r.json());
      if (created.error) setError(created.error);
      else if (created.id) router.push(`/templates/${created.id}`);
    } finally {
      setBusyId(null);
      void load();
    }
  };

  /** The confirm's destructive action (A2): delete, then refresh. */
  const remove = async (t: TemplateRow) => {
    setBusyId(t.id);
    setPendingDelete(null);
    const r = await fetch(`/api/templates/${t.id}`, { method: "DELETE" }).then((r) => r.json());
    setBusyId(null);
    if (r.error) setError(r.error);
    void load();
  };

  const runImport = async () => {
    if (!yamlText.trim()) return;
    setBusyId("__import");
    const r = await fetch("/api/templates/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml: yamlText }),
    }).then((r) => r.json());
    setBusyId(null);
    if (r.error) {
      // validation problems stay inside the dialog, next to the YAML they
      // point at — not as a page-top alert (A4)
      setImportError(r.error);
      return;
    }
    setImporting(false);
    setYamlText("");
    void load();
    if (r.id) router.push(`/templates/${r.id}`);
  };

  /** A picked/dropped file's text lands in the paste box (editable after). */
  const readImportFile = (file: File) => {
    file
      .text()
      .then((text) => {
        setYamlText(text);
        setImportError(null);
      })
      .catch(() => setImportError(`Could not read ${file.name}.`));
  };

  if (!templates) {
    return (
      <div className="p-6">
        {error ? <Alert variant="destructive">{error}</Alert> : <Spinner />} Loading…
      </div>
    );
  }

  // starters (built-in seeds) pinned first, user templates below
  const starters = templates.filter((t) => Boolean(t.is_builtin));
  const mine = templates.filter((t) => !t.is_builtin);

  return (
    <div>
      <header className="flex items-end justify-between gap-4 mb-7">
        <div>
          <h1 className="text-lg font-semibold tracking-tight m-0">Templates</h1>
          <p className="text-muted-foreground text-[12.5px] mt-1 mb-0">Flow templates compose built-in and your own nodes. Edit here or ship YAML.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setImportError(null); setImporting(true); }}>
            <Upload size={13} /> Import YAML
          </Button>
          <Button onClick={() => void create()} disabled={busyId === "__new"}>
            {busyId === "__new" ? <Spinner /> : <Plus size={13} />} New template
          </Button>
        </div>
      </header>

      {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}

      <div className="grid gap-3">
        {mine.length === 0 && starters.length === 0 && (
          <Card className="justify-center items-center gap-2 py-10 border-dashed! shadow-none! text-muted-foreground">
            No templates yet — duplicate a starter below or create a blank template.
          </Card>
        )}

        {starters.length > 0 && (
          <div className="mt-2">
            <h2 className="text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px] mb-2 flex items-center gap-1.5">
              <Sparkles size={12} /> Starters — duplicate to customize
            </h2>
            <div className="grid gap-3">
              {starters.map((t: TemplateRow) => (
                <TemplateRowCard key={t.id} t={t} busyId={busyId} onOpen={() => { router.push(`/templates/${t.id}`); }}
                  onDuplicate={() => void duplicate(t)} />
              ))}
            </div>
          </div>
        )}

        {/* A3: the heading only when the list is non-empty; an inline hint
            otherwise (the starters section already anchors the page) */}
        {mine.length > 0 && (
          <h2 className="text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px] mt-3 mb-1">
            Your templates
          </h2>
        )}
        {mine.length === 0 && starters.length > 0 && (
          <p className="text-[12px] text-muted-foreground mt-3 m-0">
            No templates yet — duplicate a starter above or create a new one.
          </p>
        )}
        {mine.map((t: TemplateRow) => (
          <TemplateRowCard key={t.id} t={t} busyId={busyId}
            onOpen={() => { router.push(`/templates/${t.id}`); }}
            onDuplicate={() => void duplicate(t)}
            onDelete={() => setPendingDelete(t)} />
        ))}
      </div>

      {/* import dialog: file upload / drag-drop + paste; validation problems
          render inside, next to the YAML (A4); explicit Cancel (A5) */}
      <Dialog open={importing} onOpenChange={(v) => { setImporting(v); if (!v) setImportError(null); }}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Import template YAML</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <p className="text-[12px] text-muted-foreground m-0">
              The config-as-code shape: name / trigger / nodes (key, type, trigger, config) / edges.
            </p>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) readImportFile(file);
              }}
              className="grid gap-2 rounded-lg border border-dashed border-border p-3"
            >
              <div className="flex items-center gap-2">
                <label
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12.5px] cursor-pointer hover:bg-muted/60 transition-colors",
                  )}
                  title="Load a YAML file into the box below"
                >
                  <Upload size={12} /> Choose a file…
                  <input
                    type="file"
                    accept=".yaml,.yml,.json,text/yaml,application/x-yaml,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) readImportFile(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <span className="text-[11.5px] text-muted-foreground">or drop a .yaml file here, or paste below</span>
              </div>
              <Textarea value={yamlText} onChange={(e) => setYamlText(e.target.value)} rows={14} className="font-mono text-[12px]" placeholder={"name: My flow\ntype: manual\nnodes:\n  - key: plan\n    type: builtin/plan\n    trigger:\n      type: manual\nedges:\n  - [plan, build]"} />
            </div>
            {importError && <Alert variant="destructive">{importError}</Alert>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImporting(false); setImportError(null); }}>
              Cancel
            </Button>
            <Button onClick={() => void runImport()} disabled={busyId === "__import" || !yamlText.trim()}>
              {busyId === "__import" ? <Spinner /> : <Upload size={13} />} Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm (A2): styled AlertDialog, not the native confirm() */}
      <AlertDialog open={pendingDelete != null} onOpenChange={(v) => { if (!v) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The template and its graph are removed. Instances on running flows
              snapshot at creation and are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => pendingDelete && void remove(pendingDelete)} disabled={busyId === pendingDelete?.id}>
              {busyId === pendingDelete?.id ? <Spinner /> : <Trash2 size={13} />} Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
