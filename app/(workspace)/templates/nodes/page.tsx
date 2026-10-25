"use client";
/**
 * Template Nodes — the shared node catalog (§8). One DataTable over
 * `node_templates` (same pattern as the Templates gallery):
 *   - built-in SDLC nodes pinned first, then the reusable custom nodes;
 *   - "New node" creates a global declarative node (agent / decision / http /
 *     script) that every template's builder lists under Library;
 *   - Configure edits name / description / the kind's definition (PATCH);
 *   - Delete asks through the styled AlertDialog — the server refuses rows
 *     still referenced by template nodes, and that error is surfaced here;
 *   - built-ins are code-defined, so they carry no actions.
 * The editor palette's Library section renders exactly the custom rows
 * managed here — this page is their single authoring surface.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Blocks,
  Bot,
  FileCode2,
  GitBranch,
  Globe,
  Pencil,
  Plus,
  Trash2,
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/data-table";
import { fmtDate } from "@/lib/format";

type NodeRow = {
  id: string;
  key: string;
  name: string;
  kind: string;
  version: number;
  description: string | null;
  icon: string | null;
  is_builtin: boolean;
  config: Record<string, unknown>;
  template_id: string | null;
  is_local: boolean;
  updated_at: string;
};

/** The declarative kinds a Template Node can have, in display order. */
const NODE_KINDS = [
  { kind: "agent", title: "Agent" },
  { kind: "decision", title: "Decision" },
  { kind: "http", title: "HTTP" },
  { kind: "script", title: "Script" },
] as const;
type NodeKind = (typeof NODE_KINDS)[number]["kind"];

const isNodeKind = (k: string): k is NodeKind =>
  NODE_KINDS.some((n) => n.kind === k);

const KIND_ICONS: Record<NodeKind, typeof Bot> = {
  agent: Bot,
  decision: GitBranch,
  http: Globe,
  script: FileCode2,
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** A kind's scope badge: built-ins are code, library rows are shared,
 *  template-local rows belong to one template's builder. */
function scopeOf(n: NodeRow): "built-in" | "library" | "template-local" {
  if (n.is_builtin) return "built-in";
  return n.is_local ? "template-local" : "library";
}

// ── the create/edit form state (one flat shape across all kinds) ────────────

type NodeFormState = {
  name: string;
  description: string;
  kind: NodeKind;
  // agent
  prompt: string;
  mode: "plan" | "agent";
  output: "markdown" | "json";
  // decision
  question: string;
  /** one branch label per line — parsed into `choices` on submit */
  choicesText: string;
  // http
  url: string;
  method: string;
  body: string;
  // script
  runtime: "shell" | "node" | "python";
  script: string;
};

const EMPTY_FORM: NodeFormState = {
  name: "",
  description: "",
  kind: "agent",
  prompt: "",
  mode: "plan",
  output: "markdown",
  question: "",
  choicesText: "",
  url: "",
  method: "GET",
  body: "",
  runtime: "shell",
  script: "",
};

/** The stored definition for the form's kind (server re-validates per kind). */
function buildConfig(f: NodeFormState): Record<string, unknown> {
  switch (f.kind) {
    case "agent":
      return { prompt: f.prompt, mode: f.mode, output: f.output };
    case "decision":
      return {
        question: f.question,
        choices: f.choicesText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((label) => ({ label })),
      };
    case "http":
      return { url: f.url, method: f.method, body: f.body === "" ? null : f.body };
    case "script":
      return { runtime: f.runtime, script: f.script };
  }
}

/** Prefill the form from a row's stored definition (Configure). */
function formFromRow(n: NodeRow): NodeFormState {
  const c = n.config ?? {};
  const str = (k: string, fallback = "") =>
    typeof c[k] === "string" ? (c[k] as string) : fallback;
  const kind = isNodeKind(n.kind) ? n.kind : "agent";
  const choices = Array.isArray(c.choices)
    ? (c.choices as { label?: unknown }[])
        .map((ch) => (typeof ch?.label === "string" ? ch.label : ""))
        .filter(Boolean)
        .join("\n")
    : "";
  return {
    ...EMPTY_FORM,
    name: n.name,
    description: n.description ?? "",
    kind,
    prompt: str("prompt"),
    mode: c.mode === "agent" ? "agent" : "plan",
    output: c.output === "json" ? "json" : "markdown",
    question: str("question"),
    choicesText: choices,
    url: str("url"),
    method: (HTTP_METHODS as readonly string[]).includes(str("method")) ? str("method") : "GET",
    body: typeof c.body === "string" ? c.body : "",
    runtime: c.runtime === "node" || c.runtime === "python" ? c.runtime : "shell",
    script: str("script"),
  };
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function TemplateNodesPage() {
  const [nodes, setNodes] = useState<NodeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** null = dialog closed; a row = Configure it; `{ id: null }` = create */
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState<NodeFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  /** the node behind the styled delete confirm */
  const [pendingDelete, setPendingDelete] = useState<NodeRow | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/node-templates").then((r) => r.json()).catch(() => null);
    if (r?.nodeTemplates) setNodes(r.nodeTemplates);
    else {
      setError("failed to load template nodes");
      setNodes([]); // end the skeleton even on failure (error alert explains why)
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setFormField = useCallback(
    (patch: Partial<NodeFormState>) => setForm((f) => ({ ...f, ...patch })),
    [],
  );

  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditing({ id: null });
  }, []);

  const openConfigure = useCallback((n: NodeRow) => {
    setForm(formFromRow(n));
    setFormError(null);
    setEditing({ id: n.id });
  }, []);

  /** Create or save, then refresh — validation problems stay in the dialog. */
  const save = async () => {
    if (!form.name.trim()) {
      setFormError("name is required");
      return;
    }
    if (form.kind === "decision" && !form.choicesText.split("\n").some((l) => l.trim())) {
      setFormError("a decision needs at least one choice — one branch label per line");
      return;
    }
    setBusyId("__form");
    const res = await fetch(editing?.id ? `/api/node-templates/${editing.id}` : "/api/node-templates", {
      method: editing?.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: form.description || null,
        kind: form.kind,
        config: buildConfig(form),
      }),
    })
      .then((r) => r.json())
      .catch(() => null);
    setBusyId(null);
    if (res?.error) {
      setFormError(res.error);
      return;
    }
    setEditing(null);
    void load();
  };

  /** The confirm's destructive action: delete, then refresh (the server
   *  refuses rows still referenced by template nodes — surface that). */
  const remove = useCallback(async (n: NodeRow) => {
    setBusyId(n.id);
    setPendingDelete(null);
    const r = await fetch(`/api/node-templates/${n.id}`, { method: "DELETE" })
      .then((r) => r.json())
      .catch(() => null);
    setBusyId(null);
    if (r?.error) setError(r.error);
    void load();
  }, [load]);

  // ── node table columns ─────────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<NodeRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Node",
        cell: ({ row }) => {
          const n = row.original;
          const Icon = isNodeKind(n.kind) ? KIND_ICONS[n.kind] : Blocks;
          return (
            <div className="min-w-[220px] max-w-[420px]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-grid size-6 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Icon size={12} />
                </span>
                <span className="truncate text-[13px] font-medium">{n.name}</span>
              </div>
              {n.description && (
                <p className="mt-0.5 mb-0 truncate pl-8 text-[12px] text-muted-foreground">
                  {n.description}
                </p>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "kind",
        header: "Kind",
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[11px]">
            {row.original.kind}
          </Badge>
        ),
      },
      {
        id: "scope",
        accessorFn: (n) => scopeOf(n),
        header: "Scope",
        cell: ({ row }) => {
          const scope = scopeOf(row.original);
          return scope === "built-in" ? (
            <Badge className="bg-info/10 text-info">built-in</Badge>
          ) : (
            <Badge variant="outline">{scope}</Badge>
          );
        },
      },
      {
        accessorKey: "version",
        header: "Version",
        cell: ({ row }) => (
          <span className="text-[12px] text-muted-foreground">v{row.original.version}</span>
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
          const rank = (n: NodeRow) => (n.is_builtin ? 0 : 1);
          if (rank(a.original) !== rank(b.original))
            return rank(a.original) - rank(b.original);
          return b.original.updated_at.localeCompare(a.original.updated_at);
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const n = row.original;
          if (n.is_builtin) return null; // code-defined — nothing to manage here
          return (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => openConfigure(n)}>
                <Pencil size={12} /> Configure
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Delete"
                disabled={busyId === n.id}
                onClick={() => setPendingDelete(n)}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          );
        },
      },
    ],
    [openConfigure, busyId],
  );

  return (
    <div>
      <header className="flex items-end justify-between gap-4 mb-7">
        <div>
          <h1 className="text-lg font-semibold tracking-tight m-0">Template nodes</h1>
          <p className="text-muted-foreground text-[12.5px] mt-1 mb-0">
            The shared node catalog — built-in SDLC nodes plus reusable custom
            nodes. Every template&apos;s builder lists your nodes under Library.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={13} /> New node
        </Button>
      </header>

      {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}

      <section className="mb-6">
        <h2 className="text-[12px] font-medium mb-3 text-muted-foreground uppercase tracking-[1.2px] flex items-center gap-2">
          <Blocks size={13} /> Nodes
          {nodes && nodes.length > 0 && (
            <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">
              {nodes.length}
            </span>
          )}
        </h2>

        <DataTable
          columns={columns}
          data={nodes ?? []}
          loading={nodes == null}
          searchable
          searchPlaceholder="Search nodes…"
          pageSize={25}
          initialSorting={[{ id: "updated_at", desc: false }]}
          emptyMessage={
            error
              ? `Failed to load template nodes: ${error}`
              : "No nodes yet — add one to make it available in every template's builder."
          }
        />
      </section>

      {/* create / configure dialog: identity + the kind's definition */}
      <Dialog
        open={editing != null}
        onOpenChange={(v) => {
          setEditing(v ? editing : null);
          if (!v) setFormError(null);
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Configure node" : "New node"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="node-name">Name</Label>
              <Input
                id="node-name"
                value={form.name}
                onChange={(e) => setFormField({ name: e.target.value })}
                placeholder="Summarize diff"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="node-description">Description</Label>
              <Input
                id="node-description"
                value={form.description}
                onChange={(e) => setFormField({ description: e.target.value })}
                placeholder="Shows up under the node name in the builder"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Kind</Label>
              <Select
                value={form.kind}
                onValueChange={(v) => setFormField({ kind: v as NodeKind })}
                disabled={editing?.id != null}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NODE_KINDS.map((k) => (
                    <SelectItem key={k.kind} value={k.kind}>{k.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <NodeKindFields form={form} set={setFormField} />
            {formError && <Alert variant="destructive">{formError}</Alert>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busyId === "__form"}>
              {busyId === "__form" ? <Spinner /> : <Plus size={13} />}
              {editing?.id ? "Save node" : "Create node"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm: styled AlertDialog, not the native confirm() */}
      <AlertDialog open={pendingDelete != null} onOpenChange={(v) => { if (!v) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete node “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The node disappears from every template&apos;s Library. Nodes still
              placed in templates can&apos;t be deleted — remove them there first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingDelete && void remove(pendingDelete)}
              disabled={busyId === pendingDelete?.id}
            >
              {busyId === pendingDelete?.id ? <Spinner /> : <Trash2 size={13} />} Delete node
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── per-kind definition fields (create + configure share them) ──────────────

function NodeKindFields({
  form,
  set,
}: {
  form: NodeFormState;
  set: (patch: Partial<NodeFormState>) => void;
}) {
  switch (form.kind) {
    case "agent":
      return (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-prompt">Prompt</Label>
            <Textarea
              id="agent-prompt"
              value={form.prompt}
              onChange={(e) => set({ prompt: e.target.value })}
              rows={4}
              placeholder="What the agent should do… ({{vars}} allowed)"
              className="text-[12px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Mode</Label>
              <Select value={form.mode} onValueChange={(v) => set({ mode: v as NodeFormState["mode"] })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="plan">plan (read-only judgment)</SelectItem>
                  <SelectItem value="agent">agent (repo workspace run)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Output</Label>
              <Select value={form.output} onValueChange={(v) => set({ output: v as NodeFormState["output"] })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="markdown">markdown</SelectItem>
                  <SelectItem value="json">json</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </>
      );
    case "decision":
      return (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="decision-question">Question</Label>
            <Textarea
              id="decision-question"
              value={form.question}
              onChange={(e) => set({ question: e.target.value })}
              rows={3}
              placeholder="How to make the call ({{vars}} allowed) — the answer maps to a branch"
              className="text-[12px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="decision-choices">Choices</Label>
            <Textarea
              id="decision-choices"
              value={form.choicesText}
              onChange={(e) => set({ choicesText: e.target.value })}
              rows={3}
              placeholder={"One branch label per line, e.g.\nyes\nno"}
              className="text-[12px]"
            />
            <p className="text-[11px] text-muted-foreground m-0">
              One branch label per line — the branch list the node picks from.
            </p>
          </div>
        </>
      );
    case "http":
      return (
        <>
          <div className="grid grid-cols-[1fr_130px] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="http-url">URL</Label>
              <Input
                id="http-url"
                value={form.url}
                onChange={(e) => set({ url: e.target.value })}
                placeholder="https://… ({{vars}} and {{secrets.NAME}} allowed)"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Method</Label>
              <Select value={form.method} onValueChange={(v) => set({ method: v ?? "GET" })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HTTP_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="http-body">Body</Label>
            <Textarea
              id="http-body"
              value={form.body}
              onChange={(e) => set({ body: e.target.value })}
              rows={3}
              placeholder="Request body as text ({{…}} interpolated) — optional"
              className="text-[12px]"
            />
          </div>
        </>
      );
    case "script":
      return (
        <>
          <div className="grid gap-1.5">
            <Label>Runtime</Label>
            <Select value={form.runtime} onValueChange={(v) => set({ runtime: v as NodeFormState["runtime"] })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="shell">shell</SelectItem>
                <SelectItem value="node">node</SelectItem>
                <SelectItem value="python">python</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="script-source">Script</Label>
            <Textarea
              id="script-source"
              value={form.script}
              onChange={(e) => set({ script: e.target.value })}
              rows={5}
              className="font-mono text-[12px]"
              placeholder="The script source ({{vars}} interpolated)"
            />
          </div>
        </>
      );
  }
}
