"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Download,
  LayoutTemplate,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Spinner } from "../../components/ui/spinner";
import { Textarea } from "../../components/ui/textarea";

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
  return (
    <Card className="p-0 gap-0 shadow-sm! overflow-hidden">
      <div className="px-4 py-3.5 flex items-start gap-3">
        <span className="size-9 shrink-0 grid place-items-center rounded-xl bg-muted">
          <Workflow size={16} className="text-muted-foreground" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/templates/${t.id}`} className="font-medium text-[13.5px] hover:underline">
              {t.name}
            </Link>
            {Boolean(t.is_builtin) && (
              <Badge className="bg-blue-500/10 text-blue-400">built-in</Badge>
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
            Open
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
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [importing, setImporting] = useState(false);
  const [yamlText, setYamlText] = useState("");
  /** non-fatal import notices (legacy ticket_id / {{ticket.*}} compat) */
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/templates").then((r) => r.json()).catch(() => null);
    if (r?.templates) setTemplates(r.templates);
    else setError("failed to load templates");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusyId("__new");
    const r = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName || undefined, description: newDesc || undefined }),
    }).then((r) => r.json());
    setBusyId(null);
    if (r.error) {
      setError(r.error);
      return;
    }
    setCreating(false);
    setNewName("");
    setNewDesc("");
    void load();
    if (r.id) location.assign(`/templates/${r.id}`);
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
      else if (created.id) location.assign(`/templates/${created.id}`);
    } finally {
      setBusyId(null);
      void load();
    }
  };

  const remove = async (t: TemplateRow) => {
    if (!confirm(`Delete template "${t.name}"? Template instances on running flows snapshot at creation and are unaffected.`)) return;
    setBusyId(t.id);
    const r = await fetch(`/api/templates/${t.id}`, { method: "DELETE" }).then((r) => r.json());
    setBusyId(null);
    if (r.error) setError(r.error);
    void load();
  };

  const runImport = async () => {
    if (!yamlText.trim()) return;
    setBusyId("__import");
    setImportWarnings([]);
    const r = await fetch("/api/templates/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml: yamlText }),
    }).then((r) => r.json());
    setBusyId(null);
    if (r.error) {
      setError(r.error);
      return;
    }
    // legacy-YAML compat notices (ticket_id dropped, {{ticket.*}} remapped):
    // keep the dialog open over the refreshed list so the user reads them
    if (r.warnings?.length) {
      setImportWarnings(r.warnings as string[]);
      void load();
      return;
    }
    setImporting(false);
    setYamlText("");
    void load();
    if (r.id) location.assign(`/templates/${r.id}`);
  };

  if (!templates) {
    return (
      <main className="p-6">
        {error ? <Alert variant="destructive">{error}</Alert> : <Spinner />} Loading…
      </main>
    );
  }

  // starters (built-in seeds) pinned first, user templates below
  const starters = templates.filter((t) => Boolean(t.is_builtin));
  const mine = templates.filter((t) => !t.is_builtin);

  return (
    <main className="max-w-[900px] mx-auto px-6 py-10">
      <header className="flex items-center gap-3.5 mb-8">
        <Button variant="ghost" size="sm" render={<Link href="/" />} className="-ml-1.5 gap-1.5 text-muted-foreground">
          <ArrowLeft className="size-3.5" /> DevFlow
        </Button>
        <LayoutTemplate size={18} className="text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold m-0 leading-tight">Templates</h1>
          <p className="text-muted-foreground text-[12px] m-0">Flow templates compose built-in and your own nodes. Edit here or ship YAML.</p>
        </div>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => setImporting(true)}>
          <Upload size={13} /> Import YAML
        </Button>
        <Button onClick={() => setCreating(true)}>
          <Plus size={13} /> New template
        </Button>
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
                <TemplateRowCard key={t.id} t={t} busyId={busyId} onOpen={() => { location.assign(`/templates/${t.id}`); }}
                  onDuplicate={() => void duplicate(t)} />
              ))}
            </div>
          </div>
        )}

        {(mine.length > 0 || starters.length > 0) && (
          <h2 className="text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px] mt-3 mb-1">
            Your templates
          </h2>
        )}
        {mine.map((t: TemplateRow) => (
          <TemplateRowCard key={t.id} t={t} busyId={busyId}
            onOpen={() => { location.assign(`/templates/${t.id}`); }}
            onDuplicate={() => void duplicate(t)}
            onDelete={() => void remove(t)} />
        ))}
      </div>

      {/* new template dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New flow template</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Release notes" />
            <label className="text-xs text-muted-foreground">Description</label>
            <Textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button onClick={() => void create()} disabled={busyId === "__new"}>
              {busyId === "__new" ? <Spinner /> : <Plus size={13} />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* import dialog */}
      <Dialog open={importing} onOpenChange={(v) => { setImportWarnings([]); setImporting(v); }}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Import template YAML</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <p className="text-[12px] text-muted-foreground m-0">
              The config-as-code shape: name / trigger / nodes (key, type, trigger, config) / edges.
            </p>
            {importWarnings.length > 0 && (
              <Card className="p-3 text-[12px] border-amber-500/40 bg-amber-500/[0.05] grid gap-1">
                <span className="font-medium text-amber-400">Imported — legacy ticket references were migrated:</span>
                {importWarnings.map((w, i) => <span key={i}>{w}</span>)}
              </Card>
            )}
            <Textarea value={yamlText} onChange={(e) => setYamlText(e.target.value)} rows={14} className="font-mono text-[12px]" placeholder={"name: My flow\ntype: manual\nnodes:\n  - key: plan\n    type: builtin/plan\n    trigger:\n      type: manual\nedges:\n  - [plan, build]"} />
          </div>
          <DialogFooter>
            <Button onClick={() => void runImport()} disabled={busyId === "__import" || !yamlText.trim()}>
              {busyId === "__import" ? <Spinner /> : <Upload size={13} />} Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
