"use client";
/**
 * The template gallery (§8). Phase 6 convergence:
 *  - renders as a single DataTable (same pattern as the Tasks page) with the
 *    starters (built-ins) pinned first, then your templates by updated date;
 *  - "New template" creates an *Untitled flow* instantly and opens the editor —
 *    no name dialog speed bump (the name lives in the editor's Flow settings);
 *  - delete asks through the styled AlertDialog (no native confirm());
 *  - import takes a file (upload or drag-drop) or paste, shows validation
 *    problems inside the dialog, and has an explicit Cancel;
 *  - starters' open action is labeled "Preview" (they're read-only).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import {
  Copy,
  Download,
  Plus,
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/data-table";
import { fmtDate } from "@/lib/format";
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

/** "3 nodes" / "1 node" — shared by the Nodes column. */
const nodeCountLabel = (n: number): string => `${n} node${n === 1 ? "" : "s"}`;

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
    else {
      setError("failed to load templates");
      setTemplates([]); // end the skeleton even on failure (error alert explains why)
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openTemplate = useCallback(
    (t: TemplateRow) => router.push(`/templates/${t.id}`),
    [router],
  );

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
  const duplicate = useCallback(async (t: TemplateRow) => {
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
  }, [router, load]);

  /** The confirm's destructive action (A2): delete, then refresh. */
  const remove = useCallback(async (t: TemplateRow) => {
    setBusyId(t.id);
    setPendingDelete(null);
    const r = await fetch(`/api/templates/${t.id}`, { method: "DELETE" }).then((r) => r.json());
    setBusyId(null);
    if (r.error) setError(r.error);
    void load();
  }, [load]);

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

  // ── template table columns ────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<TemplateRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Template",
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="min-w-[220px] max-w-[420px]">
              <Link href={`/templates/${t.id}`} className="group/name flex min-w-0 items-center gap-2">
                <span className="inline-grid size-6 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Workflow size={12} />
                </span>
                <span className="truncate text-[13px] font-medium group-hover/name:underline">
                  {t.name}
                </span>
              </Link>
              {t.description && (
                <p className="mt-0.5 mb-0 truncate pl-8 text-[12px] text-muted-foreground">
                  {t.description}
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: "type",
        accessorFn: (t) => (Boolean(t.is_builtin) ? "built-in" : "custom"),
        header: "Type",
        cell: ({ row }) =>
          Boolean(row.original.is_builtin) ? (
            <Badge className="bg-info/10 text-info">built-in</Badge>
          ) : (
            <Badge variant="outline">custom</Badge>
          ),
      },
      {
        id: "trigger",
        accessorFn: (t) => String(t.trigger?.type ?? "manual"),
        header: "Trigger",
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[11px]">
            {String(row.original.trigger?.type ?? "manual")}
          </Badge>
        ),
      },
      {
        accessorKey: "nodeCount",
        header: "Nodes",
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[11px]">
            {nodeCountLabel(row.original.nodeCount)}
          </Badge>
        ),
      },
      {
        accessorKey: "updated_at",
        header: "Updated",
        cell: ({ row }) => (
          <span className="text-[12px] text-muted-foreground">
            {fmtDate(row.original.updated_at) || "—"}
          </span>
        ),
        // default view: built-ins pinned first, newest within each group
        sortingFn: (a, b) => {
          const rank = (isBuiltin: number) => (Boolean(isBuiltin) ? 0 : 1);
          if (rank(a.original.is_builtin) !== rank(b.original.is_builtin))
            return rank(a.original.is_builtin) - rank(b.original.is_builtin);
          return b.original.updated_at.localeCompare(a.original.updated_at);
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const t = row.original;
          const builtin = Boolean(t.is_builtin);
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="outline" onClick={() => openTemplate(t)}>
                {builtin ? "Preview" : "Open"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Duplicate"
                disabled={busyId === t.id}
                onClick={() => void duplicate(t)}
              >
                {busyId === t.id ? <Spinner /> : <Copy size={13} />}
              </Button>
              <a href={`/api/templates/${t.id}/export`} title="Export YAML">
                <Button size="sm" variant="ghost">
                  <Download size={13} />
                </Button>
              </a>
              {!builtin && (
                <Button
                  size="sm"
                  variant="ghost"
                  title="Delete"
                  disabled={busyId === t.id}
                  onClick={() => setPendingDelete(t)}
                >
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [openTemplate, duplicate, busyId],
  );

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

      <section className="mb-6">
        <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px] flex items-center gap-2">
          <Workflow size={13} /> Templates
          {templates && templates.length > 0 && (
            <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">
              {templates.length}
            </span>
          )}
        </h2>

        <DataTable
          columns={columns}
          data={templates ?? []}
          loading={templates == null}
          searchable
          searchPlaceholder="Search templates…"
          pageSize={25}
          initialSorting={[{ id: "updated_at", desc: false }]}
          emptyMessage={
            error
              ? `Failed to load templates: ${error}`
              : "No templates yet — duplicate a starter or create one."
          }
        />
      </section>

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
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}
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
