"use client";
/**
 * The template editor (§8, Phase 5): a visual flow builder — a drag-drop
 * canvas (@xyflow/react over the template graph) with drawers for node and
 * edge configuration. Clicking a node opens its configurator in a drawer;
 * structural edits (add node, connect, delete) mutate a local draft that
 * replaces the template graph wholesale on Save; node drags sync x/y
 * immediately through the positions-only PATCH. Built-in templates are
 * read-only — duplicate from the gallery to customize.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import dagre from "@dagrejs/dagre";
import Link from "next/link";
import {
  ArrowLeft,
  LayoutTemplate,
  Lock,
  Save,
  Settings2,
  Trash2,
  Webhook as WebhookIcon,
  Workflow,
} from "lucide-react";
import { Alert } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Spinner } from "../../../components/ui/spinner";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import { cn } from "../../../lib/utils";
import AddNodeDialog, { type CreateNodeDef } from "../../../components/template-editor/AddNodeDialog";
import { NodeConfiguratorBody, type IncomingLink } from "../../../components/template-editor/NodeConfigurator";
import NodePalette from "../../../components/template-editor/NodePalette";
import BuilderCanvas, { type BuilderApi } from "../../../components/template-editor/BuilderCanvas";
import { FLOW_TRIGGER_TYPE } from "../../../components/template-editor/constants";
import type { EditorEdge, EditorNode, NodeContract } from "../../../components/template-editor/types";
import { describeTrigger, nodeRelationships } from "../../../components/template-editor/types";
import type { TaskProviderInfo } from "../../../components/template-editor/types";

/** A registered task provider's editor-facing slice (GET /api/tasks/providers). */
type TaskProvider = TaskProviderInfo;

type Position = { x: number; y: number };

type Draft = {
  template: {
    id: string;
    name: string;
    description: string | null;
    version: number;
    is_builtin: boolean;
    trigger: Record<string, unknown>;
  };
  nodes: EditorNode[];
  edges: EditorEdge[];
};

const EDGE_KINDS = ["next", "loop"] as const;

/** The default Start node instance — the flow's entry: nothing points at it, it
 *  carries the branch trigger, and it finishes immediately (registry "start"). */
function startNodeInstance(): EditorNode {
  return {
    key: "start",
    nodeTemplateId: "nt_start",
    label: "start",
    overrideLabel: null,
    trigger: { type: "auto" },
    join_mode: "all",
    config: {},
    input_map: {},
    kind: null,
    icon: "Play",
    catalog_name: "Start",
    is_builtin: true,
  };
}

/**
 * Auto-connect rule: a newly placed node gets one `next` edge from the flow's
 * entry — the node no edge points at (the Start node) — so a palette pick
 * never strands an isolated node. Rewire on the canvas for chains/branches.
 * `branchLabel` pre-labels the edge when the entry is a decision (branch wiring).
 */
function connectNew(edges: EditorEdge[], nodes: EditorNode[], key: string, branchLabel?: string | null): EditorEdge[] {
  const entryKey = nodes.find((n) => n.key !== key && !edges.some((e) => e.to === n.key))?.key ?? nodes[0]?.key;
  if (!entryKey || entryKey === key) return edges;
  if (edges.some((e) => e.from === entryKey && e.to === key)) return edges;
  return [...edges, { from: entryKey, to: key, kind: "next", label: branchLabel ?? null, condition: null }];
}

/** Default node_templates icon per declarative kind (lucide names the graph resolves). */
const KIND_ICONS: Record<string, string> = {
  agent: "bot",
  decision: "Split",
  http: "Send",
  script: "Terminal",
};

// ── dagre auto-layout (fallback for nodes without saved positions) ───────────

const LAYOUT_W = 190,
  LAYOUT_H = 68;

function dagreLayout(nodes: EditorNode[], edges: EditorEdge[]): Record<string, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 46, ranksep: 96, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.key, { width: LAYOUT_W, height: LAYOUT_H });
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const out: Record<string, Position> = {};
  for (const n of nodes) {
    const p = g.node(n.key);
    out[n.key] = { x: p.x, y: p.y };
  }
  return out;
}

function initialPositions(nodes: EditorNode[], edges: EditorEdge[], saved: Record<string, Position>) {
  const auto = dagreLayout(nodes, edges);
  // saved positions win; auto-layout only fills the gaps (and centers anything new)
  return Object.fromEntries(nodes.map((n) => [n.key, saved[n.key] ?? auto[n.key]])) as Record<string, Position>;
}

export default function TemplateEditorPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  /** the authoring dialog opens at this declarative kind (palette buttons) */
  const [authorKind, setAuthorKind] = useState<"agent" | "decision" | "http" | "script">("agent");
  // drawers: node configurator, edge editor, flow settings
  const [nodeDrawer, setNodeDrawer] = useState<string | null>(null);
  const [edgeDrawer, setEdgeDrawer] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // flow-trigger side data: the inbound hook (webhook trigger) + the repo
  // binding pickers (webhook/schedule auto-create flows)
  const [hook, setHook] = useState<{ id: string; secret: string; filter: string | null } | null>(null);
  const [repos, setRepos] = useState<any[]>([]);
  /** registered task providers — the Task context panel's type picker +
   *  {{task.*}} chips (contextFields) across every node configurator */
  const [providers, setProviders] = useState<TaskProvider[]>([]);
  /** decision node key → branch choices (label / description / condition) —
   *  drives the canvas's labeled branch handles (attach-only wiring). The
   *  instance override wins; otherwise the catalog def is fetched once. */
  const [branchChoices, setBranchChoices] = useState<
    Record<string, { label: string; description?: string; condition?: string }[]>
  >({});
  const choiceCache = useRef<Record<string, { label: string; description?: string; condition?: string }[] | null>>({});
  const builderApi = useRef<BuilderApi | null>(null);

  const templateId = (() => {
    const seg = typeof location !== "undefined" ? location.pathname.split("/").filter(Boolean) : [];
    return seg.length >= 2 && seg[0] === "templates" ? seg[1] : null;
  })();

  const load = useCallback(async () => {
    setError(null);
    const data = await fetch(`/api/templates/${templateId}`).then((r) => r.json()).catch(() => null);
    if (data?.template) {
      // map the API's snake_case rows onto the EditorNode draft shape
      const saved: Record<string, Position> = {};
      const d: Draft = {
        template: data.template,
        nodes: (data.nodes ?? []).map((n: any) => {
          if (typeof n.x === "number" && typeof n.y === "number") saved[n.key] = { x: n.x, y: n.y };
          return {
            key: n.key,
            nodeTemplateId: n.node_template_id,
            label: n.label,
            overrideLabel: n.label && n.label !== n.catalog_name ? n.label : null,
            trigger: n.trigger ?? { type: "auto" },
            join_mode: n.join_mode ?? "all",
            config: n.config ?? {},
            input_map: n.input_map ?? {},
            kind: n.kind ?? null,
            icon: n.icon ?? null,
            catalog_name: n.catalog_name ?? null,
            is_builtin: Boolean(n.is_builtin),
            description: n.description ?? null,
          };
        }),
        edges: (data.edges ?? []).map((e: any) => ({ from: e.from, to: e.to, kind: e.kind, label: e.label ?? null, condition: e.condition ?? null })),
      };
      setDraft(d);
      setPositions(initialPositions(d.nodes, d.edges, saved));
      setHook(data.hook ?? null);
      // templates created before the Start node existed stay empty: seed the
      // entry node into the draft (marked dirty so a Save persists it)
      if (!data.template?.is_builtin && d.nodes.length === 0) {
        setDraft((cur) => (cur && cur.nodes.length === 0 ? { ...cur, nodes: [startNodeInstance()] } : cur));
        setDirty(true);
        setNotice("Start node added by default — Save to keep it.");
      }
    } else setError(data?.error ?? "failed to load template");
  }, [templateId]);

  useEffect(() => {
    if (templateId) void load();
  }, [templateId, load]);

  // decision branch choices per instance — the canvas's labeled branch handles.
  // An instance override on config.choices wins; otherwise the catalog def is
  // fetched once per (nodeTemplateId, config) pair.
  useEffect(() => {
    if (!draft) return;
    let alive = true;
    const next: Record<string, { label: string; description?: string; condition?: string }[]> = {};
    const pending: { key: string; ck: string; url: string }[] = [];
    for (const n of draft.nodes) {
      if (n.kind !== "decision") continue;
      const own = n.config?.choices;
      if (Array.isArray(own) && own.some((c: any) => c?.label)) {
        next[n.key] = own as { label: string; description?: string; condition?: string }[];
        continue;
      }
      const cfgQ =
        n.config && Object.keys(n.config).length ? JSON.stringify(n.config) : "";
      const ck = `${n.nodeTemplateId}::${cfgQ}`;
      const cached = choiceCache.current[ck];
      if (cached) {
        next[n.key] = cached;
        continue;
      }
      pending.push({
        key: n.key,
        ck,
        url: `/api/contracts?def=${encodeURIComponent(n.nodeTemplateId)}${cfgQ ? `&config=${encodeURIComponent(cfgQ)}` : ""}`,
      });
    }
    setBranchChoices(next);
    for (const p of pending) {
      fetch(p.url)
        .then((r) => r.json())
        .then((c: NodeContract) => {
          const choices = (c as any)?.choices ?? [];
          choiceCache.current[p.ck] = choices;
          if (alive) setBranchChoices((cur) => ({ ...cur, [p.key]: choices }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [draft]);

  useEffect(() => {
    // binding pickers: repos from the Settings page; task providers (the
    // Task context panel's types + {{task.*}} chip vocabulary) from the registry
    fetch("/api/tasks/providers").then((r) => r.json()).then((d) => setProviders(d?.providers ?? [])).catch(() => {});
    fetch("/api/repos").then((r) => r.json()).then((d) => setRepos(d?.repos ?? [])).catch(() => {});
  }, []);

  const apply = (next: Draft) => {
    setDraft(next);
    setDirty(true);
    setNotice(null);
  };

  const patchNode = (key: string, patch: Partial<EditorNode>) => {
    setDraft((cur) => cur
      ? { ...cur, nodes: cur.nodes.map((p) => (p.key === key ? { ...p, ...patch } : p)) }
      : cur);
    setDirty(true);
    setNotice(null);
  };

  /** Removes the node and any edges touching it. */
  const removeNode = (node: EditorNode) => {
    if (!draft) return;
    apply({
      ...draft,
      nodes: draft.nodes.filter((n) => n.key !== node.key),
      edges: draft.edges.filter((e) => e.from !== node.key && e.to !== node.key),
    });
    setNodeDrawer(null);
  };

  const removeEdge = (index: number) => {
    if (!draft) return;
    apply({ ...draft, edges: draft.edges.filter((_, i) => i !== index) });
    setEdgeDrawer(null);
  };

  /** A new edge from the canvas. From a decision node's branch handle the
   *  edge arrives pre-labeled with that branch — attach-only wiring, no edge
   *  editing (the drawer stays closed); any other connect opens the drawer to
   *  finish it, and decision sources still auto-pick a free branch label. */
  const addEdge = (from: string, to: string, branchLabel?: string | null) => {
    if (!draft) return;
    const exists = draft.edges.some(
      (e) => e.from === from && e.to === to && (!e.label || e.label === branchLabel),
    );
    if (exists) {
      setNotice(`Nodes are already connected (${from} → ${to}).`);
      return;
    }
    const nextEdges: EditorEdge[] = [
      ...draft.edges,
      { from, to, kind: "next", label: branchLabel ?? null, condition: null },
    ];
    apply({ ...draft, edges: nextEdges });
    if (!branchLabel) {
      setEdgeDrawer(nextEdges.length - 1);
      autoLabelDecisionEdge(from, to, nextEdges);
    }
  };

  /** Decision branches: fetch the decision's choices and label the new edge
   *  with the first choice no sibling edge uses yet — the outgoing edges then
   *  read as the branches they carry. Silent on failure (label stays editable
   *  in the edge drawer). */
  const autoLabelDecisionEdge = (from: string, to: string, edges: EditorEdge[]) => {
    const src = draft?.nodes.find((n) => n.key === from);
    if (src?.kind !== "decision") return;
    const cfg =
      src.config && Object.keys(src.config).length
        ? `&config=${encodeURIComponent(JSON.stringify(src.config))}`
        : "";
    fetch(`/api/contracts?def=${encodeURIComponent(src.nodeTemplateId)}${cfg}`)
      .then((r) => r.json())
      .then((c: NodeContract & { choices?: { label: string }[] }) => {
        const choices = c?.choices ?? [];
        if (!choices.length) return;
        const used = new Set(
          edges.filter((e) => e.from === from && e.label).map((e) => e.label as string),
        );
        const label = choices.find((ch) => !used.has(ch.label))?.label;
        if (!label) return;
        setDraft((cur) =>
          cur
            ? {
                ...cur,
                edges: cur.edges.map((e) =>
                  e.from === from && e.to === to && !e.label ? { ...e, label } : e,
                ),
              }
            : cur,
        );
        setDirty(true);
      })
      .catch(() => {});
  };

  // position drag sync: persist x/y via the positions-only PATCH (debounced),
  // so layout survives without a structural Save — even while flows run
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePositionsSave = useCallback(() => {
    if (!templateId || draft?.template.is_builtin) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setPositions((current) => {
        void fetch(`/api/templates/${templateId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positions: current }),
        }).catch(() => {});
        return current;
      });
    }, 700);
  }, [templateId, draft?.template.is_builtin]);

  /** Build + place a new node instance (palette pick or authored catalog node):
   *  auto-connected from the flow's entry node (connectNew), drawer opens. */
  const addInstance = (opts: {
    nodeTemplateId: string;
    name: string;
    kind: string | null;
    icon: string | null;
    isBuiltin: boolean;
  }): string | null => {
    if (!draft) return null;
    const key = uniqueKey(opts.name || "node", draft.nodes);
    placeNewNode(key);
    // auto-connect from the flow's entry; when the entry is a decision node
    // the edge carries the next unused branch label (pre-wired branch)
    const entryKey = draft.nodes.find(
      (n) => n.key !== key && !draft.edges.some((e) => e.to === n.key),
    )?.key ?? draft.nodes[0]?.key;
    const entryChoices = entryKey ? branchChoices[entryKey] : undefined;
    const entryBranch =
      entryKey && draft.nodes.find((n) => n.key === entryKey)?.kind === "decision" && entryChoices?.length
        ? (entryChoices.find(
            (c) => !draft.edges.some((e) => e.from === entryKey && e.label === c.label),
          )?.label ?? null)
        : null;
    apply({
      ...draft,
      nodes: [...draft.nodes, {
        key,
        nodeTemplateId: opts.nodeTemplateId,
        label: key,
        overrideLabel: null,
        trigger: { type: "auto" },
        join_mode: "all",
        config: {},
        input_map: {},
        kind: opts.kind,
        icon: opts.icon,
        catalog_name: opts.name,
        is_builtin: opts.isBuiltin,
      }],
      edges: connectNew(draft.edges, draft.nodes, key, entryBranch),
    });
    setNodeDrawer(key);
    return key;
  };

  /** A palette pick: place an instance of the catalog row on the canvas. */
  const addCatalogNode = (nodeTemplateId: string, isBuiltin: boolean, catalogKey: string, name: string) => {
    if (!draft) return;
    // only one Start node per template (the server's singleton rule enforces
    // the same at save time — fail friendly here instead)
    if (catalogKey === "start" && draft.nodes.some((n) => n.nodeTemplateId === "nt_start")) {
      setNotice("Only one Start node is allowed — this template already has one.");
      setAdding(false);
      return;
    }
    addInstance({ nodeTemplateId, name, kind: null, icon: null, isBuiltin });
    setAdding(false);
  };

  /**
   * One-click custom-node add (palette kind buttons): create the catalog row
   * server-side (auto-named, seeded defaults — a decision starts with two
   * branch choices), then place the instance — addInstance auto-connects it
   * from the flow's entry and opens its drawer. The prompt/knobs are authored
   * there, after connecting, so the upstream run context is clickable.
   */
  const addKindNode = async (kind: "agent" | "decision" | "http" | "script") => {
    if (!draft) return;
    setCreatingAgent(true);
    try {
      const seeded = kind === "decision" ? { choices: [{ label: "yes" }, { label: "no" }] } : {};
      const r = await fetch("/api/node-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, config: seeded }),
      }).then((r) => r.json());
      if (r.error) {
        setError(r.error);
        return;
      }
      const nt = r.nodeTemplate;
      addInstance({
        nodeTemplateId: nt.id,
        name: nt.name,
        kind: nt.kind,
        icon: nt.icon ?? KIND_ICONS[kind] ?? "bot",
        isBuiltin: false,
      });
    } finally {
      setCreatingAgent(false);
    }
  };

  // ── node placement for palette additions ──────────────────────────────────
  const placeNewNode = (key: string): Position => {
    let pos: Position;
    if (draft && draft.nodes.length === 0) {
      pos = { x: 320, y: 320 };
    } else if (builderApi.current?.screenToFlowPosition && typeof window !== "undefined") {
      const center = builderApi.current.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      pos = { x: Math.round(center.x - 90), y: Math.round(center.y - 40) };
    } else {
      pos = { x: 320, y: 320 };
    }
    setPositions((p) => ({ ...p, [key]: pos }));
    return pos;
  };

  if (!draft) {
    return (
      <main className="p-6">
        {error ? <Alert variant="destructive">{error} — <Link href="/templates" className="underline">back to gallery</Link></Alert> : <Spinner />} Loading…
      </main>
    );
  }

  const readonly = draft.template.is_builtin;
  const configuring = nodeDrawer != null ? draft.nodes.find((n) => n.key === nodeDrawer) ?? null : null;
  const editingEdge = edgeDrawer != null ? draft.edges[edgeDrawer] ?? null : null;
  // the template's declared task type (trigger.task_type — the Task context
  // panel edits it): the provider's contextFields become the {{task.*}} chips
  // every node configurator offers, and the start node's contract seeder
  const taskType = String(draft.template.trigger?.task_type ?? providers[0]?.kind ?? "");
  const taskProvider = providers.find((p) => p.kind === taskType) ?? providers[0] ?? null;
  const taskFields = taskProvider?.contextFields ?? [];
  // connection info for the configured node: incoming edges resolve to the
  // Inputs tab's upstream pickers; an isolated node can't be configured yet
  const relationships = nodeRelationships(draft.nodes, draft.edges);
  const configuringLocked = configuring != null ? relationships[configuring.key]?.isolated ?? false : false;
  const configuringIncoming: IncomingLink[] = configuring
    ? draft.edges
        .map((edge, edgeIndex) => ({ edge, edgeIndex, source: draft.nodes.find((n) => n.key === edge.from) ?? null }))
        .filter((l) => l.edge.to === configuring.key && l.source)
    : [];

  return (
    <main className="fixed inset-0 flex flex-col bg-background">
      {/* ── header ── */}
      <header className="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-border bg-card">
        <Button variant="ghost" size="sm" render={<Link href="/templates" />} className="-ml-1.5 gap-1.5 text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Templates
        </Button>
        <LayoutTemplate size={17} className="text-muted-foreground" />
        <div className="min-w-0">
          <h1 className="text-[14.5px] font-semibold m-0 leading-tight flex items-center gap-2 truncate">
            {draft.template.name}
            {readonly && <Badge className="bg-blue-500/10 text-blue-400"><Lock size={9} className="mr-0.5" />built-in</Badge>}
            <Badge variant="outline" className="text-[10px]">v{draft.template.version}</Badge>
          </h1>
          <p className="text-muted-foreground text-[11px] m-0">
            {draft.nodes.length} node{draft.nodes.length === 1 ? "" : "s"} · {draft.edges.length} edge{draft.edges.length === 1 ? "" : "s"}
            {dirty && <span className="text-amber-400"> · unsaved changes</span>}
          </p>
        </div>
        <div className="flex-1" />
        {readonly && (
          <span className="text-[11.5px] text-muted-foreground flex items-center gap-1.5">
            <Lock size={11} /> read-only — <Link href="/templates" className="underline">duplicate in the gallery</Link> to edit
          </span>
        )}
        {!readonly && (
          <>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={13} /> Flow settings
            </Button>
          </>
        )}
        {readonly && (
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={13} /> Flow settings
          </Button>
        )}
        {!readonly && (
          <Button size="sm" disabled={!dirty || saving || creatingAgent} onClick={() => void save()}>
            {saving ? <Spinner /> : <Save size={13} />} Save{dirty ? "" : "d"}
          </Button>
        )}
      </header>

      {/* ── floating notices ── */}
      {(error || notice) && (
        <div className="absolute top-16 inset-x-4 z-40 flex justify-center pointer-events-none">
          <Alert
            variant={error ? "destructive" : "default"}
            className={cn("max-w-[640px] pointer-events-auto shadow-lg", error && "w-auto")}
          >
            <span>{error ?? notice}</span>
            <button
              className="ml-auto text-muted-foreground hover:text-foreground text-sm"
              onClick={() => { setError(null); setNotice(null); }}
            >
              ✕
            </button>
          </Alert>
        </div>
      )}

      {/* ── the canvas + node palette ── */}
      <div className="flex-1 min-h-0 flex">
        <NodePalette
          nodes={draft.nodes}
          readonly={readonly}
          busy={creatingAgent}
          onAddCatalogNode={addCatalogNode}
          onAddKindNode={(kind) => void addKindNode(kind)}
          onOpenAuthoring={(kind) => { setAuthorKind(kind); setAdding(true); }}
        />
        <div className="flex-1 min-w-0">
          <BuilderCanvas
            nodes={draft.nodes}
            edges={draft.edges}
            positions={positions}
            selectedNodeKey={nodeDrawer}
            selectedEdgeIndex={edgeDrawer}
            readonly={readonly}
            branchChoices={branchChoices}
            onNodeOpen={(key) => {
              setEdgeDrawer(null);
              setNodeDrawer(key);
            }}
            onEdgeOpen={(index) => {
              setNodeDrawer(null);
              setEdgeDrawer(index);
            }}
            onNodeMove={(key, x, y) => setPositions((p) => ({ ...p, [key]: { x, y } }))}
            onNodeDragStop={schedulePositionsSave}
            onConnect={addEdge}
            onPaneClick={() => {
              setNodeDrawer(null);
              setEdgeDrawer(null);
            }}
            onApi={(api) => { builderApi.current = api; }}
          />
        </div>
      </div>

      {/* ── node drawer ── */}
      <Sheet open={configuring != null} onOpenChange={(v) => { if (!v) setNodeDrawer(null); }}>
        {configuring && (
          <SheetContent className="w-[640px] max-w-[calc(100vw-18rem)]">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {configuring.overrideLabel || configuring.catalog_name || configuring.key}
                <Badge variant="outline">{configuring.kind ?? "builtin"}</Badge>
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2 flex-wrap">
                <code className="font-mono">{configuring.key}</code>
                <span>·</span>
                <span>{describeTrigger(configuring.trigger)}</span>
                {configuring.join_mode === "any" && <Badge className="bg-amber-500/10 text-amber-400 text-[10px] py-0">any-join</Badge>}
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              <div className="grid gap-1 mb-4">
                <label className="text-xs text-muted-foreground">Display name</label>
                <Input
                  value={configuring.overrideLabel ?? ""}
                  disabled={readonly}
                  placeholder={configuring.catalog_name ?? configuring.key}
                  onChange={(e) => patchNode(configuring.key, { overrideLabel: e.target.value || null })}
                />
              </div>
              <NodeConfiguratorBody
                node={configuring}
                incoming={configuringIncoming}
                locked={configuringLocked}
                taskFields={taskFields}
                onChange={(patch) => {
                  const next = { ...configuring, ...patch };
                  setDraft((cur) => cur
                    ? { ...cur, nodes: cur.nodes.map((p) => (p.key === next.key ? next : p)) }
                    : cur);
                  setDirty(true);
                  setNotice(null);
                }}
              />
            </SheetBody>
            <SheetFooter>
              {!readonly && (
                <Button variant="ghost" className="text-rose-400 hover:text-rose-300 mr-auto" onClick={() => removeNode(configuring)}>
                  <Trash2 size={13} /> Remove node
                </Button>
              )}
              <SheetFooterHelper />
            </SheetFooter>
          </SheetContent>
        )}
      </Sheet>

      {/* ── edge drawer ── */}
      {editingEdge && (
        <Sheet open={editingEdge != null} onOpenChange={(v) => { if (!v) setEdgeDrawer(null); }}>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Workflow size={14} className="text-muted-foreground" /> Edge
                <Badge variant="outline">{editingEdge.kind}</Badge>
              </SheetTitle>
              <SheetDescription className="font-mono text-[11.5px]">
                {editingEdge.from} → {editingEdge.to}
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              <EdgeEditor
                edge={editingEdge}
                index={edgeDrawer!}
                draft={draft}
                readonly={readonly}
                onChange={(patch) => {
                  if (edgeDrawer == null || !draft) return;
                  const next = { ...draft, edges: draft.edges.map((e, i) => (i === edgeDrawer ? { ...e, ...patch } : e)) };
                  apply(next);
                }}
                sourceNode={draft.nodes.find((n) => n.key === editingEdge.from) ?? null}
              />
            </SheetBody>
            <SheetFooter>
              {!readonly && (
                <Button variant="ghost" className="text-rose-400 hover:text-rose-300 mr-auto" onClick={() => removeEdge(edgeDrawer!)}>
                  <Trash2 size={13} /> Remove edge
                </Button>
              )}
              <SheetFooterHelper />
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}

      {/* ── flow settings drawer ── */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Settings2 size={14} className="text-muted-foreground" /> Flow settings
            </SheetTitle>
            <SheetDescription>Template meta + how flows start from it.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <SettingsBody
              draft={draft}
              readonly={readonly}
              hook={hook}
              providers={providers}
              repos={repos}
              onChange={(t) => apply({ ...draft, template: { ...draft.template, ...t } })}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>

      <AddNodeDialog
        open={adding}
        initialMode={authorKind}
        creativeBusy={creatingAgent}
        taskFields={taskFields}
        onClose={() => setAdding(false)}
        onAddCatalogNode={addCatalogNode}
        onCreateNode={async (def: CreateNodeDef) => {
          setCreatingAgent(true);
          try {
            const r = await fetch("/api/node-templates", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: def.name,
                kind: def.kind,
                icon: KIND_ICONS[def.kind] ?? "bot",
                description: def.description ?? `Declarative ${def.kind} node`,
                config: def.config,
              }),
            }).then((r) => r.json());
            if (r.error) return { err: r.error };
            const nodeTemplateId: string = r.nodeTemplate.id;
            addInstance({
              nodeTemplateId,
              name: def.name,
              kind: def.kind,
              icon: KIND_ICONS[def.kind] ?? "bot",
              isBuiltin: false,
            });
            setAdding(false);
            return { nodeTemplateId };
          } finally {
            setCreatingAgent(false);
          }
        }}
      />
    </main>
  );

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/templates/${draft.template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.template.name,
          description: draft.template.description,
          trigger: draft.template.trigger,
          nodes: draft.nodes.map((n) => ({
            key: n.key,
            nodeTemplateId: n.nodeTemplateId,
            label: n.overrideLabel ?? null,
            trigger: n.trigger,
            join_mode: n.join_mode,
            config: n.config,
            input_map: n.input_map,
            x: positions[n.key]?.x ?? null,
            y: positions[n.key]?.y ?? null,
          })),
          edges: draft.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, label: e.label, condition: e.condition })),
        }),
      }).then((r) => r.json());
      if (r.error) setError(r.error);
      else {
        setDirty(false);
        setNotice("Draft saved — new flows snapshot this version.");
        // the hook (webhook trigger) is provisioned/synced server-side — refresh it
        void load();
      }
    } finally {
      setSaving(false);
    }
  }
}

/** Small helper text for drawer footers (kept declarative). */
function SheetFooterHelper() {
  return <span className="text-[11px] text-muted-foreground sm:mr-2">Esc closes · edits live on the canvas draft</span>;
}

// ── edge editor ──────────────────────────────────────────────────────────────

function EdgeEditor({
  edge, draft, readonly, onChange, sourceNode,
}: {
  edge: EditorEdge;
  index: number;
  draft: Draft;
  readonly: boolean;
  onChange: (patch: Partial<EditorEdge>) => void;
  sourceNode: EditorNode | null;
}) {
  // decision sources: the edge label must be one of the decision's choices —
  // offer quick-picks from the contract
  const [choices, setChoices] = useState<{ label: string; description?: string }[] | null>(null);
  const isDecision = sourceNode?.kind === "decision";
  useEffect(() => {
    if (!isDecision || !sourceNode) {
      setChoices(null);
      return;
    }
    let alive = true;
    fetch(`/api/contracts?def=${encodeURIComponent(sourceNode.nodeTemplateId)}`)
      .then((r) => r.json())
      .then((c: NodeContract) => {
        if (alive) setChoices((c as any)?.choices ?? []);
      })
      .catch(() => alive && setChoices([]));
    return () => { alive = false; };
  }, [isDecision, sourceNode?.nodeTemplateId]);

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">From</label>
          <EdgeSelect value={edge.from} nodes={draft.nodes} disabled={readonly} onChange={(v) => onChange({ from: v })} />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <EdgeSelect value={edge.to} nodes={draft.nodes} disabled={readonly} onChange={(v) => onChange({ to: v })} />
        </div>
      </div>
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Kind</label>
        <select
          value={edge.kind}
          disabled={readonly}
          onChange={(ev) => onChange({ kind: ev.target.value as EditorEdge["kind"] })}
          className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2"
        >
          {EDGE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <p className="text-[11px] text-muted-foreground m-0">
          {edge.kind === "loop" ? "Loop edges re-trigger the target once it has finished (bounds come from the target's max-attempt knobs)." : "A plain forward edge."}
        </p>
      </div>
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">
          Label {isDecision && <span className="text-amber-400">— required for decision branches</span>}
        </label>
        {isDecision && choices && choices.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {choices.map((c) => (
              <button
                key={c.label}
                disabled={readonly}
                title={c.description}
                onClick={() => onChange({ label: c.label })}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors",
                  edge.label === c.label
                    ? "border-violet-500 bg-violet-500/10 text-violet-300"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <Input
          value={edge.label ?? ""}
          placeholder={isDecision ? "a choice of the decision node" : "label (decision branch)"}
          disabled={readonly}
          onChange={(ev) => onChange({ label: ev.target.value || null })}
        />
      </div>
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Condition (JSONata over the flow context)</label>
        <Input
          value={edge.condition ?? ""}
          placeholder={"nodes.build.output.mr_url != null"}
          disabled={readonly}
          className="font-mono text-[12.5px]"
          onChange={(ev) => onChange({ condition: ev.target.value || null })}
        />
        <p className="text-[11px] text-muted-foreground m-0">
          The edge activates only when the condition is truthy — the plan §3 build-time linter compiles it on save.
        </p>
      </div>
    </div>
  );
}

function EdgeSelect({ value, nodes, disabled, onChange }: { value: string; nodes: EditorNode[]; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="bg-card text-foreground border border-border rounded-lg text-[12.5px] px-2 py-1.5 font-mono"
    >
      {nodes.map((n) => <option key={n.key} value={n.key}>{n.key}</option>)}
    </select>
  );
}

// ── flow settings body (shared manual/webhook/schedule wiring, Phase 4 pickers) ─

function SettingsBody({
  draft, readonly, hook, providers, repos, onChange,
}: {
  draft: Draft;
  readonly: boolean;
  hook: { id: string; secret: string; filter: string | null } | null;
  /** registered task providers (GET /api/tasks/providers) */
  providers: { kind: string; label: string; configured: boolean; contextFields: { key: string; label: string; type: string; required?: boolean }[] }[];
  repos: any[];
  onChange: (t: Partial<Draft["template"]>) => void;
}) {
  const trigger = draft.template.trigger ?? {};
  const setTrigger = (patch: Record<string, unknown>) =>
    onChange({ trigger: { ...trigger, ...patch } });
  // the declared task type (Phase 3): which task type the template's flows run
  // on — its provider's contextFields are the {{task.*}} variables every node
  // maps against. Absent → the first registered provider (matching the store's
  // parse rule).
  const taskType = String(trigger.task_type ?? providers[0]?.kind ?? "");
  const taskProvider = providers.find((p) => p.kind === taskType) ?? providers[0] ?? null;
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Template name</label>
        <Input value={draft.template.name} disabled={readonly} onChange={(e) => onChange({ name: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Description</label>
        <textarea
          value={draft.template.description ?? ""}
          rows={2}
          disabled={readonly}
          onChange={(e) => onChange({ description: e.target.value || null })}
          className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2"
        />
      </div>

      {/* ── Task context (Phase 3): the declared task type + its fields ── */}
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Task context</label>
        <select
          value={taskType}
          disabled={readonly || providers.length === 0}
          onChange={(e) => setTrigger({ task_type: e.target.value || undefined })}
          className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2"
        >
          {providers.length === 0 && <option value="">no task providers registered</option>}
          {providers.map((p) => (
            <option key={p.kind} value={p.kind}>{p.label} ({p.kind}){p.configured ? "" : " — not configured"}</option>
          ))}
        </select>
        {taskProvider && (
          <div className="flex gap-1 flex-wrap pt-1">
            {taskProvider.contextFields.map((f) => (
              <span
                key={f.key}
                title={`${f.label} — type ${f.type}${f.required ? ", always present" : ""}`}
                className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-mono text-muted-foreground"
              >
                {"{{task." + f.key + "}}"}
              </span>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground m-0">
          Flows started from this template run on a {taskProvider?.label ?? taskType} task — its fields
          (above) are available to every node as {"{{task.*}}"} variables, no wiring needed.
        </p>
      </div>

      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Flow trigger</label>
        <select
          value={String(trigger.type ?? "manual")}
          disabled={readonly}
          onChange={(e) => setTrigger({ type: e.target.value })}
          className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2"
        >
          {Object.entries(FLOW_TRIGGER_TYPE).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground m-0">
          {String(trigger.type ?? "manual") === "manual"
            ? "Started from the home page's task picker."
            : `Auto-creates flows — bind a repo below; each flow attaches the most recent imported ${taskType} task.`}
        </p>
      </div>

      {["webhook", "schedule"].includes(String(trigger.type ?? "manual")) && (
        <div className="grid gap-3">
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">Bound repo</label>
            <select
              value={String(trigger.repo_id ?? "")}
              onChange={(e) => setTrigger({ repo_id: e.target.value || undefined })}
              className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2"
            >
              <option value="">— pick a repo —</option>
              {repos.map((r) => <option key={r.id} value={r.id}>{r.name}{r.local_path ? " (local)" : ""}</option>)}
            </select>
          </div>
          {String(trigger.type) === "schedule" && (
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">Interval (minutes)</label>
              <Input
                type="number"
                min={1}
                value={Number(trigger.interval_min ?? 60)}
                disabled={readonly}
                onChange={(e) => setTrigger({ interval_min: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })}
              />
              <p className="text-[11px] text-muted-foreground m-0">One new flow per fire, started automatically from the repo binding above.</p>
            </div>
          )}
          {String(trigger.type) === "webhook" && (
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">Filter (JSONata over the delivery)</label>
              <Input
                value={String(trigger.filter ?? "")}
                placeholder={"payload.event = 'issue.created' (empty = every delivery starts a flow)"}
                className="font-mono text-[12.5px]"
                disabled={readonly}
                onChange={(e) => setTrigger({ filter: e.target.value || undefined })}
              />
              {hook && (
                <Card className="p-3 grid gap-1.5 mt-1">
                  <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
                    <WebhookIcon size={12} /> Inbound hook
                  </div>
                  <code className="font-mono text-[12px] break-all">POST /api/hooks/{hook.id}</code>
                  <code className="font-mono text-[12px] text-muted-foreground break-all">secret {hook.secret}</code>
                  <code className="font-mono text-[12px] text-muted-foreground break-all">
                    {"node scripts/send-hook.mjs <url> <secret> '{\"event\":\"issue.created\"}'"}
                  </code>
                  <p className="text-[11px] text-muted-foreground m-0">Delivery body becomes <code className="font-mono">{"{{trigger.payload}}"}</code> in the flow&apos;s context. Save to apply filter changes.</p>
                </Card>
              )}
              {!hook && <p className="text-[11px] text-muted-foreground m-0">The hook endpoint appears once the template is saved or duplicated.</p>}
            </div>
          )}
        </div>
      )}
      {readonly && (
        <p className="text-[11.5px] text-muted-foreground m-0 flex items-start gap-1.5">
          <Lock size={12} className="mt-0.5 shrink-0" />
          Built-in templates are read-only. Use the gallery&apos;s duplicate action to make an editable copy.
        </p>
      )}
    </div>
  );
}

function uniqueKey(base: string, nodes: EditorNode[]): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node";
  if (!nodes.some((n) => n.key === slug)) return slug;
  for (let i = 2; ; i++) if (!nodes.some((n) => n.key === `${slug}_${i}`)) return `${slug}_${i}`;
}
