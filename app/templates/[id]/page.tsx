"use client";
/**
 * The template editor (§8, Phase 5): a visual flow builder — a drag-drop
 * canvas (@xyflow/react over the template graph) with drawers for node and
 * edge configuration. Clicking a node opens its configurator in a drawer;
 * structural edits (add node, connect, delete) mutate a local draft that
 * replaces the template graph wholesale on Save; node drags sync x/y
 * immediately through the positions-only PATCH. Built-in templates are
 * read-only — duplicate from the gallery to customize.
 *
 * Phase 1 canvas behavior: palette picks place an unconnected node at the
 * viewport center (no auto-wiring, no auto-opened drawer — the user drags
 * from a handle to connect); Backspace/Delete remove the selection; and
 * structural changes are undoable (⌘Z / ⇧⌘Z over draft snapshots). Leaving
 * with unsaved changes is guarded (beforeunload + a styled confirm on the
 * back link).
 *
 * Phase 2 deferred node creation: the palette's kind tiles place in-memory
 * draft instances (`nodeTemplateId: "draft:<n>"`, def in draft.pendingDefs) —
 * nothing is created server-side until Save, so abandoned placements never
 * pollute the node catalog. Save PATCHes `new_node_templates`; the route
 * creates the rows, remaps the ids, then saves the graph. The drawer is the
 * single authoring surface (the old authoring dialog is gone).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import dagre from "@dagrejs/dagre";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  LayoutTemplate,
  Lock,
  Redo2,
  Save,
  Settings2,
  Trash2,
  Undo2,
  Webhook as WebhookIcon,
  Workflow,
} from "lucide-react";
import { Alert } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
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
import { NodeConfiguratorBody, type IncomingLink } from "../../../components/template-editor/NodeConfigurator";
import NodePalette from "../../../components/template-editor/NodePalette";
import BuilderCanvas, { type BuilderApi } from "../../../components/template-editor/BuilderCanvas";
import { FLOW_TRIGGER_TYPE } from "../../../components/template-editor/constants";
import type { DraftNodeDef, EditorEdge, EditorNode, NodeContract } from "../../../components/template-editor/types";
import { contractsUrl, describeTrigger, nodeRelationships } from "../../../components/template-editor/types";
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
  /** unsaved declarative defs backing `draft:<n>` instances (Phase 2) —
   *  persisted as node_templates rows only on Save */
  pendingDefs?: Record<string, DraftNodeDef>;
};

const EDGE_KINDS = ["next", "loop"] as const;

/** Display names for the palette's New-node tiles (also the saved row names). */
const KIND_LABELS: Record<string, string> = {
  agent: "Agent node",
  decision: "Decision node",
  http: "HTTP node",
  script: "Script node",
};

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
  const router = useRouter();
  const [draft, setDraftState] = useState<Draft | null>(null);
  /** the draft mirrored in a ref — undo/redo and the keyboard handler read the
   *  live value even from closures that outlive a render */
  const draftRef = useRef<Draft | null>(null);
  const setDraft = useCallback(
    (next: Draft | null | ((cur: Draft | null) => Draft | null)) => {
      const resolved = typeof next === "function" ? next(draftRef.current) : next;
      draftRef.current = resolved;
      setDraftState(resolved);
    },
    [],
  );
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** bumped after each Save — the palette's catalog cache keys off it so new
   *  Library rows appear without a page reload (Phase 2) */
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  /** monotonically growing — draft ids never collide within a session */
  const draftSeq = useRef(1);
  // drawers: node configurator, edge editor, flow settings
  const [nodeDrawer, setNodeDrawer] = useState<string | null>(null);
  const [edgeDrawer, setEdgeDrawer] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** the just-placed node (canvas selection highlight while no drawer is open) */
  const [placedKey, setPlacedKey] = useState<string | null>(null);
  /** the styled "leave with unsaved changes?" confirm on the back link */
  const [confirmLeave, setConfirmLeave] = useState(false);
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

  // ── undo / redo: structural draft snapshots taken in apply() ───────────────
  const undoStack = useRef<Draft[]>([]);
  const redoStack = useRef<Draft[]>([]);
  /** bursts of structural edits (typing in a field) coalesce into one snapshot */
  const lastSnapAt = useRef(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncUndoFlags = useCallback(() => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }, []);

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
      // a fresh template load resets the undo history — snapshots of a
      // previous session's draft would rewind past what's on the server
      undoStack.current = [];
      redoStack.current = [];
      lastSnapAt.current = 0;
      syncUndoFlags();
      // templates created before the Start node existed stay empty: seed the
      // entry node into the draft (marked dirty so a Save persists it). New
      // templates seed their Start node server-side at creation — silent, so
      // this notice only ever surfaces for legacy-empty graphs.
      if (!data.template?.is_builtin && d.nodes.length === 0) {
        setDraft((cur) => (cur && cur.nodes.length === 0 ? { ...cur, nodes: [startNodeInstance()] } : cur));
        setDirty(true);
        setNotice("Start node added by default — Save to keep it.");
      }
    } else setError(data?.error ?? "failed to load template");
  }, [templateId, setDraft, syncUndoFlags]);

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
        url: contractsUrl(n),
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

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    const cur = draftRef.current;
    if (cur) redoStack.current.push(cur);
    setDraft(prev);
    setDirty(true);
    setNotice(null);
    // the restored draft may have different nodes/edges — a drawer open on a
    // now-different index would edit the wrong element
    setNodeDrawer(null);
    setEdgeDrawer(null);
    setPlacedKey(null);
    syncUndoFlags();
  }, [setDraft, syncUndoFlags]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    const cur = draftRef.current;
    if (cur) undoStack.current.push(cur);
    setDraft(next);
    setDirty(true);
    setNotice(null);
    setNodeDrawer(null);
    setEdgeDrawer(null);
    setPlacedKey(null);
    syncUndoFlags();
  }, [setDraft, syncUndoFlags]);

  // ⌘Z / Ctrl+Z (and ⇧ for redo) — skipped while typing so text fields keep
  // their native undo, and inert on read-only built-ins
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      if (draft?.template.is_builtin) return;
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, draft]);

  // unsaved-changes guard: reload / tab close asks before discarding the draft
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const apply = useCallback((next: Draft) => {
    const cur = draftRef.current;
    if (cur) {
      // structural changes (nodes/edges replaced) snapshot for undo; meta-only
      // edits and rapid bursts (each keystroke re-replaces the edges array)
      // coalesce into the previous snapshot instead of flooding the stack
      const structural = next.nodes !== cur.nodes || next.edges !== cur.edges;
      const now = Date.now();
      if (structural && (undoStack.current.length === 0 || now - lastSnapAt.current > 500)) {
        undoStack.current.push(cur);
        if (undoStack.current.length > 50) undoStack.current.shift();
        redoStack.current = [];
        lastSnapAt.current = now;
      }
    }
    setDraft(next);
    setDirty(true);
    setNotice(null);
    syncUndoFlags();
  }, [setDraft, syncUndoFlags]);

  const patchNode = (key: string, patch: Partial<EditorNode>) => {
    setDraft((cur) => cur
      ? { ...cur, nodes: cur.nodes.map((p) => (p.key === key ? { ...p, ...patch } : p)) }
      : cur);
    setDirty(true);
    setNotice(null);
  };

  /** Removes a node and any edges touching it (footer button + keyboard
   *  deletes both land here). The Start node is protected — it's the flow's
   *  entry; delete its outgoing edges instead to strand a branch. */
  const removeNode = (node: EditorNode) => {
    if (!draft) return;
    if (node.nodeTemplateId === "nt_start") {
      setNotice("The Start node can't be deleted — it's the flow's entry. Rewire its edges instead.");
      return;
    }
    apply({
      ...draft,
      nodes: draft.nodes.filter((n) => n.key !== node.key),
      edges: draft.edges.filter((e) => e.from !== node.key && e.to !== node.key),
    });
    setNodeDrawer((cur) => (cur === node.key ? null : cur));
    setPlacedKey((cur) => (cur === node.key ? null : cur));
    // the removed node's edges shift the edge indexes — close a stale drawer
    setEdgeDrawer(null);
  };

  /** Keyboard-delete path from the canvas (BuilderCanvas resolves the id). */
  const removeNodeKey = (key: string) => {
    const node = draft?.nodes.find((n) => n.key === key);
    if (node) removeNode(node);
  };

  /** Removes an edge by draft index (footer button + keyboard deletes —
   *  BuilderCanvas resolves the flow edge id `edge<i>` to this index). */
  const removeEdge = (index: number) => {
    if (!draft) return;
    apply({ ...draft, edges: draft.edges.filter((_, i) => i !== index) });
    setEdgeDrawer((cur) =>
      cur == null ? cur : cur === index ? null : cur > index ? cur - 1 : cur,
    );
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
    fetch(contractsUrl(src))
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

  /**
   * Build + place a new node instance (palette pick): viewport center,
   * selected, deliberately unconnected — nothing is wired or opened for the
   * user (auto-connecting pre-wired branches the user then had to unwind was
   * the top daily annoyance). The hint names the connect gesture: drag from a
   * node's handle. Config happens when the user opens the drawer.
   */
  const addInstance = (opts: {
    nodeTemplateId: string;
    name: string;
    kind: string | null;
    icon: string | null;
    isBuiltin: boolean;
    /** set for draft instances (Phase 2): the def rides in pendingDefs until Save */
    draftDef?: DraftNodeDef;
  }): string | null => {
    if (!draft) return null;
    const key = uniqueKey(opts.name || "node", draft.nodes);
    placeNewNode(key);
    apply({
      ...draft,
      pendingDefs: opts.draftDef
        ? { ...draft.pendingDefs, [opts.draftDef.draftId]: opts.draftDef }
        : draft.pendingDefs,
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
    });
    setNodeDrawer(null);
    setPlacedKey(key);
    setNotice("Node placed — drag from one of its handles to connect it.");
    return key;
  };

  /** A palette pick: place an instance of the catalog row on the canvas
   *  (unconnected, at the viewport center — addInstance does the placing).
   *  Built-in rows and Library rows are persisted — the instance references
   *  the real row; no draft def involved. */
  const addCatalogNode = (nodeTemplateId: string, isBuiltin: boolean, catalogKey: string, name: string) => {
    if (!draft) return;
    // only one Start node per template (the server's singleton rule enforces
    // the same at save time — fail friendly here instead)
    if (catalogKey === "start" && draft.nodes.some((n) => n.nodeTemplateId === "nt_start")) {
      setNotice("Only one Start node is allowed — this template already has one.");
      return;
    }
    addInstance({ nodeTemplateId, name, kind: null, icon: null, isBuiltin });
  };

  /**
   * A New-node tile (Phase 2): place an in-memory draft instance of the kind —
   * `nodeTemplateId: "draft:<n>"`, def in pendingDefs. No POST at click time:
   * nothing server-side exists until Save (abandoned placements never pollute
   * the catalog). The decision's seeded branches ride in the instance config,
   * so the drawer/canvas see them immediately.
   */
  const addDraftKindNode = (kind: "agent" | "decision" | "http" | "script") => {
    if (!draft) return;
    const draftId = `draft:${draftSeq.current++}`;
    const name = nextDraftName(kind, draft);
    addInstance({
      nodeTemplateId: draftId,
      name,
      kind,
      icon: KIND_ICONS[kind] ?? "bot",
      isBuiltin: false,
      draftDef: {
        draftId,
        kind,
        name,
        icon: KIND_ICONS[kind] ?? "bot",
        description: `Custom ${kind} node — reusable from the Library once saved`,
        config: {},
      },
    });
    // the decision's seeded branches belong to the instance config (the
    // drawer edits it; Save folds it into the persisted def)
    if (kind === "decision") {
      const config = { choices: [{ label: "yes" }, { label: "no" }] };
      setDraft((cur) =>
        cur
          ? { ...cur, nodes: cur.nodes.map((n) => (n.nodeTemplateId === draftId ? { ...n, config } : n)) }
          : cur,
      );
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
        <Button
          variant="ghost"
          size="sm"
          className="-ml-1.5 gap-1.5 text-muted-foreground"
          onClick={() => {
            if (dirty) setConfirmLeave(true);
            else router.push("/templates");
          }}
        >
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
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={13} /> Flow settings
          </Button>
        )}
        {!readonly && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!canUndo}
              title="Undo (⌘Z)"
              onClick={undo}
            >
              <Undo2 size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!canRedo}
              title="Redo (⇧⌘Z)"
              onClick={redo}
            >
              <Redo2 size={14} />
            </Button>
          </>
        )}
        {!readonly && (
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
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
          catalogEpoch={catalogEpoch}
          onAddCatalogNode={addCatalogNode}
          onAddKindNode={addDraftKindNode}
        />
        <div className="flex-1 min-w-0">
          <BuilderCanvas
            nodes={draft.nodes}
            edges={draft.edges}
            positions={positions}
            selectedNodeKey={nodeDrawer ?? placedKey}
            selectedEdgeIndex={edgeDrawer}
            readonly={readonly}
            branchChoices={branchChoices}
            onNodeOpen={(key) => {
              setEdgeDrawer(null);
              setPlacedKey(null);
              setNodeDrawer(key);
            }}
            onEdgeOpen={(index) => {
              setNodeDrawer(null);
              setPlacedKey(null);
              setEdgeDrawer(index);
            }}
            onNodeMove={(key, x, y) => setPositions((p) => ({ ...p, [key]: { x, y } }))}
            onNodeDragStop={schedulePositionsSave}
            onConnect={addEdge}
            onNodeRemove={removeNodeKey}
            onEdgeRemove={removeEdge}
            onPaneClick={() => {
              setNodeDrawer(null);
              setEdgeDrawer(null);
              setPlacedKey(null);
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

      {/* ── leave-with-unsaved-changes confirm (back link, when dirty) ── */}
      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave with unsaved changes?</DialogTitle>
            <DialogDescription>
              Nodes and connections you added are only kept when you Save. Your
              last saved version stays as it is.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLeave(false)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmLeave(false);
                setDirty(false); // don't trip the beforeunload guard on the way out
                router.push("/templates");
              }}
            >
              Leave without saving
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      // draft declarative defs (Phase 2): the tiles placed in-memory instances;
      // only defs still referenced by a node are persisted, with the authored
      // instance config folded in so the Library row reflects what was authored
      const new_node_templates = collectPendingDefs(draft);
      const r = await fetch(`/api/templates/${draft.template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.template.name,
          description: draft.template.description,
          trigger: draft.template.trigger,
          ...(new_node_templates.length ? { new_node_templates } : {}),
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
        // the catalog may have gained Library rows (draft defs persisted) —
        // bump the epoch so the palette re-fetches (Phase 2)
        if (new_node_templates.length) setCatalogEpoch((e) => e + 1);
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
    fetch(contractsUrl(sourceNode))
      .then((r) => r.json())
      .then((c: NodeContract) => {
        if (alive) setChoices((c as any)?.choices ?? []);
      })
      .catch(() => alive && setChoices([]));
    return () => { alive = false; };
  }, [isDecision, sourceNode?.nodeTemplateId, sourceNode?.config, sourceNode?.kind]);

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

/** Display name for a placed draft def — "Agent node", then "Agent node 2", …
 *  avoiding collisions with this draft's other pending defs (the server
 *  versions the name further if a persisted row owns the key). */
function nextDraftName(kind: string, draft: Draft): string {
  const base = KIND_LABELS[kind] ?? "Custom node";
  const taken = new Set(Object.values(draft.pendingDefs ?? {}).map((d) => d.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

/**
 * The Save payload's `new_node_templates` (Phase 2): pending defs still
 * referenced by a draft node. The referencing instances' authored config is
 * folded into the def config (the persisted row then reflects what the drawer
 * authored, so the Library entry is reusable as-is). Defs whose nodes were
 * deleted/undone away are dropped — abandoned placements leave nothing behind.
 */
function collectPendingDefs(draft: Draft): {
  draft_id: string; kind: string; name: string; icon: string | null;
  description: string | null; config: Record<string, unknown>;
}[] {
  const out: {
    draft_id: string; kind: string; name: string; icon: string | null;
    description: string | null; config: Record<string, unknown>;
  }[] = [];
  for (const def of Object.values(draft.pendingDefs ?? {})) {
    const users = draft.nodes.filter((n) => n.nodeTemplateId === def.draftId);
    if (users.length === 0) continue;
    let config = def.config;
    for (const n of users) config = { ...config, ...n.config };
    out.push({
      draft_id: def.draftId,
      kind: def.kind,
      name: def.name,
      icon: def.icon,
      description: def.description,
      config,
    });
  }
  return out;
}
