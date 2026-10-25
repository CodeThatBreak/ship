"use client";
/**
 * Template Nodes — the shared node catalog (§8). One DataTable over
 * `node_templates` (same pattern as the Templates gallery):
 *   - built-in SDLC nodes pinned first, then the reusable custom nodes;
 *   - "New node" creates a global declarative node (agent / decision / http /
 *     script) that every template's builder lists under Library;
 *   - Configure edits name / description / the kind's FULL definition
 *     (PATCH) — every knob the runtime class declares, rendered by the same
 *     schema-driven field machinery the builder drawer uses (the dialog is
 *     boilerplate-seeded so a new node runs as-is; authors remap inputs and
 *     tweak knobs instead of starting from a blank def);
 *   - Delete asks through the styled AlertDialog — the server refuses rows
 *     still referenced by template nodes, and that error is surfaced here;
 *   - built-ins are code-defined, so they carry no actions.
 * The editor palette's Library section renders exactly the custom rows
 * managed here — this page is their single authoring surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DataTable } from "@/components/data-table";
import { fmtDate } from "@/lib/format";
import {
  DeclarativeConfigFields,
  NODE_KIND_DESCRIPTIONS,
  NODE_TEMPLATE_KINDS,
  boilerplateFor,
  type NodeContract,
  type NodeTemplateKind,
} from "@/components/template-editor";
import { kindContractUrl } from "@/components/template-editor/types";

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
const NODE_KINDS: { kind: NodeTemplateKind; title: string }[] = [
  { kind: "agent", title: "Agent" },
  { kind: "decision", title: "Decision" },
  { kind: "http", title: "HTTP" },
  { kind: "script", title: "Script" },
];

const isNodeKind = (k: string): k is NodeTemplateKind =>
  NODE_KINDS.some((n) => n.kind === k);

const KIND_ICONS: Record<NodeTemplateKind, typeof Bot> = {
  agent: Bot,
  decision: GitBranch,
  http: Globe,
  script: FileCode2,
};

/** A kind's scope badge: built-ins are code, library rows are shared,
 *  template-local rows belong to one template's builder. */
function scopeOf(n: NodeRow): "built-in" | "library" | "template-local" {
  if (n.is_builtin) return "built-in";
  return n.is_local ? "template-local" : "library";
}

// ── the create/edit form state (identity + the kind's whole definition) ─────

type NodeFormState = {
  name: string;
  description: string;
  kind: NodeTemplateKind;
  /** the kind's full definition — edited field-by-field through
   *  DeclarativeConfigFields (same machinery as the builder drawer) */
  config: Record<string, unknown>;
};

/** A fresh create form: boilerplate definition + boilerplate description,
 *  so the node runs (and reads) as-is out of the box. */
function emptyForm(): NodeFormState {
  return {
    name: "",
    description: NODE_KIND_DESCRIPTIONS.agent,
    kind: "agent",
    config: boilerplateFor("agent"),
  };
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function TemplateNodesPage() {
  const [nodes, setNodes] = useState<NodeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** null = dialog closed; a row = Configure it; `{ id: null }` = create */
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState<NodeFormState>(() => emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  /** the node behind the styled delete confirm */
  const [pendingDelete, setPendingDelete] = useState<NodeRow | null>(null);
  /** the form kind's full field list (runtime class via /api/contracts) —
   *  refetched when the dialog opens on a different kind */
  const [contract, setContract] = useState<NodeContract | null>(null);
  /** configured secret names (http nodes' {{secrets.NAME}} chips) */
  const [secretNames, setSecretNames] = useState<string[] | null>(null);

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

  // the contract rides the dialog's kind + current definition: fields + the
  // parsed defaults for the schema-driven form. The config always rides along
  // (the drawer's draft pattern) — a blank decision def is unparseable by
  // design (choices min(1)), and the definition IS what the dialog edits.
  // The last contract stays rendered while a refetch is in flight (typing
  // must not unmount the fields); only a kind switch clears it.
  const prevKind = useRef<NodeTemplateKind | null>(null);
  useEffect(() => {
    if (editing == null) {
      prevKind.current = null;
      return;
    }
    const kindSwitched = prevKind.current !== form.kind;
    prevKind.current = form.kind;
    if (kindSwitched) setContract(null);
    let alive = true;
    fetch(kindContractUrl(form.kind, form.config))
      .then((r) => r.json())
      .then((c: NodeContract | { error?: string }) => {
        if (alive) setContract(c && "input" in c ? (c as NodeContract) : null);
      })
      .catch(() => {
        if (alive && kindSwitched) setContract(null);
      });
    return () => {
      alive = false;
    };
  }, [editing, form.kind, form.config]);

  // http kinds only: the secret names for the {{secrets.NAME}} chips
  useEffect(() => {
    if (editing == null || form.kind !== "http") return;
    let alive = true;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setSecretNames(d?.secrets ?? []);
      })
      .catch(() => {
        if (alive) setSecretNames([]);
      });
    return () => {
      alive = false;
    };
  }, [editing, form.kind]);

  /** A fresh create form — seeded with the kind's boilerplate so the node
   *  is ready to run as-is; the author tweaks rather than writes. */
  const openCreate = useCallback(() => {
    setForm(emptyForm());
    setFormError(null);
    setEditing({ id: null });
  }, []);

  /** Configure: the stored definition round-trips untouched (including the
   *  `_ts` companions the schema boxes authored with). */
  const openConfigure = useCallback((n: NodeRow) => {
    setForm({
      name: n.name,
      description: n.description ?? "",
      kind: isNodeKind(n.kind) ? n.kind : "agent",
      config: structuredClone(n.config ?? {}) as Record<string, unknown>,
    });
    setFormError(null);
    setEditing({ id: n.id });
  }, []);

  /** A kind switch on create re-seeds the definition — boilerplate per kind,
   *  never a mixed leftover of the previous kind's shape. The description
   *  follows too, unless the author already customized it. */
  const switchKind = useCallback((kind: NodeTemplateKind) => {
    setForm((f) => ({
      ...f,
      kind,
      config: boilerplateFor(kind),
      description:
        !f.description || Object.values(NODE_KIND_DESCRIPTIONS).includes(f.description)
          ? NODE_KIND_DESCRIPTIONS[kind]
          : f.description,
    }));
  }, []);

  /** Create or save, then refresh — validation problems stay in the dialog
   *  (the server re-validates the whole definition through the kind's zod
   *  schema; every field of it was editable here). */
  const save = async () => {
    if (!form.name.trim()) {
      setFormError("name is required");
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
        config: form.config,
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
                onValueChange={(v) => switchKind(v as NodeTemplateKind)}
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
              {editing?.id == null && (
                <p className="text-[11px] text-muted-foreground m-0">
                  Seeded with a working {form.kind} boilerplate — tweak it or
                  remap the inputs in the builder; nothing to write from scratch.
                </p>
              )}
            </div>

            {formError && <Alert variant="destructive">{formError}</Alert>}
            <DeclarativeConfigFields
              kind={form.kind}
              config={form.config}
              contract={contract}
              secretNames={form.kind === "http" ? secretNames : null}
              onConfigChange={(config) => setFormField({ config })}
            />
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
