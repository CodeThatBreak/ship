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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dagre from "@dagrejs/dagre";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  LayoutTemplate,
  Lock,
  Redo2,
  Save,
  Settings2,
  Trash2,
  Undo2,
  Webhook as WebhookIcon,
  Workflow,
  X,
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
import { Label } from "../../../components/ui/label";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { Textarea } from "../../../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../components/ui/collapsible";
import { cn } from "../../../lib/utils";
import {
  NodeConfiguratorBody,
  SelectOption,
  type IncomingLink,
} from "../../../components/template-editor/NodeConfigurator";
import NodePalette from "../../../components/template-editor/NodePalette";
import BuilderCanvas, {
  type BuilderApi,
} from "../../../components/template-editor/BuilderCanvas";
import { ConditionBuilder } from "../../../components/template-editor/ConditionBuilder";
import { FLOW_TRIGGER_TYPE } from "../../../components/template-editor/constants";
import type {
  DraftNodeDef,
  EditorEdge,
  EditorNode,
  NodeContract,
} from "../../../components/template-editor/types";
import {
  contractsUrl,
  describeTrigger,
  nodeLabel,
  nodeRelationships,
  isPlanDownstream,
} from "../../../components/template-editor/types";
import type { TaskProviderInfo } from "../../../components/template-editor/types";
import {
  asJsonataGroups,
  buildVarGroups,
  conditionVarGroups,
  schemaRows,
} from "../../../components/template-editor/variables";
import {
  NODE_KIND_DESCRIPTIONS,
  boilerplateFor,
} from "../../../components/template-editor";
import type { LintProblem } from "../../../lib/engine/context-lint";

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

/** Edge kinds as labeled options (the kind select's friendly labels; the
 *  stored value stays the raw kind string). */
const EDGE_KIND_OPTIONS: Record<
  string,
  { label: string; description: string }
> = {
  next: {
    label: "next — forward edge",
    description:
      "Runs the target after the source finishes; its output joins the target's input.",
  },
  loop: {
    label: "loop — re-run the target",
    description:
      "Re-triggers the target once it has finished (bounds come from the target's max-attempt knobs).",
  },
};

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
    catalogKey: "start",
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

function dagreLayout(
  nodes: EditorNode[],
  edges: EditorEdge[],
): Record<string, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 46,
    ranksep: 96,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes)
    g.setNode(n.key, { width: LAYOUT_W, height: LAYOUT_H });
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const out: Record<string, Position> = {};
  for (const n of nodes) {
    const p = g.node(n.key);
    out[n.key] = { x: p.x, y: p.y };
  }
  return out;
}

function initialPositions(
  nodes: EditorNode[],
  edges: EditorEdge[],
  saved: Record<string, Position>,
) {
  const auto = dagreLayout(nodes, edges);
  // saved positions win; auto-layout only fills the gaps (and centers anything new)
  return Object.fromEntries(
    nodes.map((n) => [n.key, saved[n.key] ?? auto[n.key]]),
  ) as Record<string, Position>;
}

export default function TemplateEditorPage() {
  const router = useRouter();
  const [draft, setDraftState] = useState<Draft | null>(null);
  /** the draft mirrored in a ref — undo/redo and the keyboard handler read the
   *  live value even from closures that outlive a render */
  const draftRef = useRef<Draft | null>(null);
  const setDraft = useCallback(
    (next: Draft | null | ((cur: Draft | null) => Draft | null)) => {
      const resolved =
        typeof next === "function" ? next(draftRef.current) : next;
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
  /** the positions-only PATCH's honest state (Phase 6 save model): "pending"
   *  while the debounced layout autosave is in flight, "saved" once it
   *  lands — the header then reads "layout autosaved · graph has unsaved
   *  changes" instead of one ambiguous "unsaved changes" */
  const [layoutSync, setLayoutSync] = useState<"idle" | "pending" | "saved">(
    "idle",
  );
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
  const [hook, setHook] = useState<{
    id: string;
    secret: string;
    filter: string | null;
  } | null>(null);
  const [repos, setRepos] = useState<any[]>([]);
  /** registered task providers — the Task context panel's type picker +
   *  {{task.*}} chips (contextFields) across every node configurator */
  const [providers, setProviders] = useState<TaskProvider[]>([]);
  /** decision node key → branch choices (label / description / condition) —
   *  drives the canvas's labeled branch handles (attach-only wiring). The
   *  instance override wins; otherwise the catalog def is fetched once. */
  const [branchChoices, setBranchChoices] = useState<
    Record<
      string,
      { label: string; description?: string; condition?: string }[]
    >
  >({});
  const choiceCache = useRef<
    Record<
      string,
      { label: string; description?: string; condition?: string }[] | null
    >
  >({});
  /** the start node's contract fields (Phase 3) — the {{trigger.payload.*}}
   *  vocabulary every node configurator offers */
  const [triggerFields, setTriggerFields] = useState<
    { key: string; label?: string; type?: string }[]
  >([]);
  const startContractCache = useRef<
    Record<string, { key: string; label?: string; type?: string }[]>
  >({});
  /** live-linted refs per node (Phase 3): node key → ref → the linter's
   *  problem — the prompt editor underlines them where they're typed */
  const [refProblems, setRefProblems] = useState<
    Record<string, Record<string, string>>
  >({});
  /** structured lint problems (Phase 5): node key → messages (canvas badges)
   *  and edge index → the condition's problem (the edge chip flags rose) */
  const [nodeProblems, setNodeProblems] = useState<Record<string, string[]>>(
    {},
  );
  const [edgeProblems, setEdgeProblems] = useState<Record<number, string>>({});
  const builderApi = useRef<BuilderApi | null>(null);

  /** B5: the route param, not location.pathname parsing. */
  const params = useParams<{ id: string }>();
  const templateId = params?.id ?? null;

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
    const data = await fetch(`/api/templates/${templateId}`)
      .then((r) => r.json())
      .catch(() => null);
    if (data?.template) {
      // map the API's snake_case rows onto the EditorNode draft shape
      const saved: Record<string, Position> = {};
      const d: Draft = {
        template: data.template,
        nodes: (data.nodes ?? []).map((n: any) => {
          if (typeof n.x === "number" && typeof n.y === "number")
            saved[n.key] = { x: n.x, y: n.y };
          return {
            key: n.key,
            nodeTemplateId: n.node_template_id,
            label: n.label,
            overrideLabel:
              n.label && n.label !== n.catalog_name ? n.label : null,
            trigger: n.trigger ?? { type: "auto" },
            join_mode: n.join_mode ?? "all",
            config: n.config ?? {},
            input_map: n.input_map ?? {},
            kind: n.kind ?? null,
            icon: n.icon ?? null,
            catalog_name: n.catalog_name ?? null,
            catalogKey: n.catalog_key ?? null,
            is_builtin: Boolean(n.is_builtin),
            isLocal: Boolean(n.is_local),
            description: n.description ?? null,
          };
        }),
        edges: (data.edges ?? []).map((e: any) => ({
          from: e.from,
          to: e.to,
          kind: e.kind,
          label: e.label ?? null,
          condition: e.condition ?? null,
        })),
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
        setDraft((cur) =>
          cur && cur.nodes.length === 0
            ? { ...cur, nodes: [startNodeInstance()] }
            : cur,
        );
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
    const next: Record<
      string,
      { label: string; description?: string; condition?: string }[]
    > = {};
    const pending: { key: string; ck: string; url: string }[] = [];
    for (const n of draft.nodes) {
      if (n.kind !== "decision") continue;
      const own = n.config?.choices;
      if (Array.isArray(own) && own.some((c: any) => c?.label)) {
        next[n.key] = own as {
          label: string;
          description?: string;
          condition?: string;
        }[];
        continue;
      }
      const cfgQ =
        n.config && Object.keys(n.config).length
          ? JSON.stringify(n.config)
          : "";
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
    fetch("/api/tasks/providers")
      .then((r) => r.json())
      .then((d) => setProviders(d?.providers ?? []))
      .catch(() => {});
    fetch("/api/repos")
      .then((r) => r.json())
      .then((d) => setRepos(d?.repos ?? []))
      .catch(() => {});
  }, []);

  // the start node's contract fields (Phase 3) — the {{trigger.payload.*}}
  // vocabulary. Cached per (nodeTemplateId, config): the contract is declared
  // per instance, so editing the start's run-context box changes it.
  useEffect(() => {
    if (!draft) return;
    const st = draft.nodes.find((n) => n.nodeTemplateId === "nt_start");
    if (!st) return;
    const ck = `${st.nodeTemplateId}::${JSON.stringify(st.config ?? {})}`;
    const cached = startContractCache.current[ck];
    if (cached) {
      // the same array reference → React bails out, no fetch/loop
      setTriggerFields(cached);
      return;
    }
    let alive = true;
    fetch(contractsUrl(st))
      .then((r) => r.json())
      .then((c: NodeContract) => {
        const fields = schemaRows(c?.output ?? null).map((r) => ({
          key: r.name,
          label: r.description ?? r.name,
          type: r.type,
        }));
        startContractCache.current[ck] = fields;
        if (alive) setTriggerFields(fields);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [draft]);

  // live validation (Phase 3 + 5): the draft validates against the static
  // linter (debounced) while it's edited — problems land where they belong:
  // per-node refs underline in the prompt editor, and the structured
  // coordinates render as canvas badges on the offending node / edge chip.
  // Read-only built-ins never validate (nothing is editable).
  useEffect(() => {
    if (!draft || draft.template.is_builtin) return;
    let alive = true;
    const timer = setTimeout(() => void validateDraft(draft, alive), 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  /** POST the draft to the validate endpoint (Phase 5) — the structured
   *  problems land in the badge state; returns them for the save gate. */
  const validateDraft = async (
    d: Draft,
    alive = true,
  ): Promise<LintProblem[]> => {
    const problems = await fetch(`/api/templates/${d.template.id}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trigger: d.template.trigger,
        nodes: d.nodes.map((n) => ({
          key: n.key,
          nodeTemplateId: n.nodeTemplateId,
          config: n.config,
          input_map: n.input_map,
        })),
        edges: d.edges.map((e) => ({
          from: e.from,
          to: e.to,
          kind: e.kind,
          label: e.label,
          condition: e.condition,
        })),
        new_node_templates: collectPendingDefs(d),
      }),
    })
      .then((r) => r.json())
      .then((d: { problems?: LintProblem[] }) => d?.problems ?? [])
      .catch(() => [] as LintProblem[]);
    if (!alive) return problems;
    applyProblems(problems);
    return problems;
  };

  /** The validate problems → where they're shown (refs underlined in prompts,
   *  badges on the canvas nodes, rose edge chips). */
  const applyProblems = (problems: LintProblem[]) => {
    const refs: Record<string, Record<string, string>> = {};
    const nodeMap: Record<string, string[]> = {};
    const edgeMap: Record<number, string> = {};
    for (const p of problems) {
      if (p.nodeKey) (nodeMap[p.nodeKey] ??= []).push(p.message);
      else if (typeof p.edgeIndex === "number")
        edgeMap[p.edgeIndex] = p.message;
      if (p.ref && p.nodeKey) (refs[p.nodeKey] ??= {})[p.ref] = p.message;
    }
    setRefProblems(refs);
    setNodeProblems(nodeMap);
    setEdgeProblems(edgeMap);
  };

  /** The problems joined as the readable save-blocker message (the same
   *  joined string the server throws with). */
  const problemsMessage = (problems: LintProblem[]): string =>
    problems
      .map((p) => (p.where ? `${p.where}: ${p.message}` : p.message))
      .join("\n");

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
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
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

  const apply = useCallback(
    (next: Draft) => {
      const cur = draftRef.current;
      if (cur) {
        // structural changes (nodes/edges replaced) snapshot for undo; meta-only
        // edits and rapid bursts (each keystroke re-replaces the edges array)
        // coalesce into the previous snapshot instead of flooding the stack
        const structural = next.nodes !== cur.nodes || next.edges !== cur.edges;
        const now = Date.now();
        if (
          structural &&
          (undoStack.current.length === 0 || now - lastSnapAt.current > 500)
        ) {
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
    },
    [setDraft, syncUndoFlags],
  );

  const patchNode = (key: string, patch: Partial<EditorNode>) => {
    setDraft((cur) =>
      cur
        ? {
            ...cur,
            nodes: cur.nodes.map((p) =>
              p.key === key ? { ...p, ...patch } : p,
            ),
          }
        : cur,
    );
    setDirty(true);
    setNotice(null);
  };

  /** Removes a node and any edges touching it (footer button + keyboard
   *  deletes both land here). The Start node is protected — it's the flow's
   *  entry; delete its outgoing edges instead to strand a branch. */
  const removeNode = (node: EditorNode) => {
    if (!draft) return;
    if (node.nodeTemplateId === "nt_start") {
      setNotice(
        "The Start node can't be deleted — it's the flow's entry. Rewire its edges instead.",
      );
      return;
    }
    apply({
      ...draft,
      nodes: draft.nodes.filter((n) => n.key !== node.key),
      edges: draft.edges.filter(
        (e) => e.from !== node.key && e.to !== node.key,
      ),
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

  /** Right-click → Duplicate node (Phase 6, G3): a fresh unique key, the
   *  config copied, placed unconnected near the original. The Start node is
   *  a singleton — duplicating it is refused (the palette enforces the same).
   *  Draft instances share their pending def — nothing extra to carry. */
  const duplicateNode = (key: string) => {
    if (!draft) return;
    const src = draft.nodes.find((n) => n.key === key);
    if (!src) return;
    if (src.nodeTemplateId === "nt_start") {
      setNotice(
        "Only one Start node is allowed — this template already has one.",
      );
      return;
    }
    const newKey = uniqueKey(
      `${src.overrideLabel || src.catalog_name || src.key} copy`,
      draft.nodes,
    );
    const pos = positions[key] ?? { x: 0, y: 0 };
    apply({
      ...draft,
      nodes: [
        ...draft.nodes,
        {
          ...src,
          key: newKey,
          label: newKey,
          overrideLabel: `${nodeLabel(src)} copy`,
        },
      ],
    });
    setPositions((p) => ({ ...p, [newKey]: { x: pos.x + 44, y: pos.y + 44 } }));
    schedulePositionsSave();
    setNotice("Node duplicated — drag from one of its handles to connect it.");
  };

  /** "Tidy layout" (Phase 6, G2): dagre over the draft graph, then the usual
   *  debounced positions autosave (a tidy is just many drags at once). */
  const tidyLayout = () => {
    if (!draft || draft.template.is_builtin) return;
    setPositions((p) => ({ ...p, ...dagreLayout(draft.nodes, draft.edges) }));
    schedulePositionsSave();
  };

  /** A new edge from the canvas. From a decision node's branch handle the
   *  edge arrives pre-labeled with that branch — attach-only wiring, no edge
   *  editing (the drawer stays closed); any other connect opens the drawer to
   *  finish it, and decision sources still auto-pick a free branch label. */
  const addEdge = (from: string, to: string, branchLabel?: string | null) => {
    if (!draft) return;
    const exists = draft.edges.some(
      (e) =>
        e.from === from && e.to === to && (!e.label || e.label === branchLabel),
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
  const autoLabelDecisionEdge = (
    from: string,
    to: string,
    edges: EditorEdge[],
  ) => {
    const src = draft?.nodes.find((n) => n.key === from);
    if (src?.kind !== "decision") return;
    fetch(contractsUrl(src))
      .then((r) => r.json())
      .then((c: NodeContract & { choices?: { label: string }[] }) => {
        const choices = c?.choices ?? [];
        if (!choices.length) return;
        const used = new Set(
          edges
            .filter((e) => e.from === from && e.label)
            .map((e) => e.label as string),
        );
        const label = choices.find((ch) => !used.has(ch.label))?.label;
        if (!label) return;
        setDraft((cur) =>
          cur
            ? {
                ...cur,
                edges: cur.edges.map((e) =>
                  e.from === from && e.to === to && !e.label
                    ? { ...e, label }
                    : e,
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
    setLayoutSync("pending");
    saveTimer.current = setTimeout(() => {
      setPositions((current) => {
        void fetch(`/api/templates/${templateId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positions: current }),
        })
          .then(() => setLayoutSync("saved"))
          .catch(() => setLayoutSync("idle"));
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
    /** the instance's starting config override — the draft's boilerplate
     *  mirrors the pending def so the drawer/canvas contract sees it now
     *  (identical values: the def stays the source, edits are overrides) */
    config?: Record<string, unknown>;
    /** the backing row's catalog key ("plan", "start", ...) - the fan-out
     *  configurator's plan-downstream gate reads it (isPlanNode) */
    catalogKey?: string | null;
  }): string | null => {
    if (!draft) return null;
    const key = uniqueKey(opts.name || "node", draft.nodes);
    placeNewNode(key);
    apply({
      ...draft,
      pendingDefs: opts.draftDef
        ? { ...draft.pendingDefs, [opts.draftDef.draftId]: opts.draftDef }
        : draft.pendingDefs,
      nodes: [
        ...draft.nodes,
        {
          key,
          nodeTemplateId: opts.nodeTemplateId,
          label: key,
          overrideLabel: null,
          trigger: { type: "auto" },
          join_mode: "all",
          config: opts.config ?? {},
          input_map: {},
          kind: opts.kind,
          icon: opts.icon,
          catalog_name: opts.name,
          catalogKey: opts.catalogKey ?? null,
          is_builtin: opts.isBuiltin,
        },
      ],
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
  const addCatalogNode = (
    nodeTemplateId: string,
    isBuiltin: boolean,
    catalogKey: string,
    name: string,
  ) => {
    if (!draft) return;
    // only one Start node per template (the server's singleton rule enforces
    // the same at save time — fail friendly here instead)
    if (
      catalogKey === "start" &&
      draft.nodes.some((n) => n.nodeTemplateId === "nt_start")
    ) {
      setNotice(
        "Only one Start node is allowed — this template already has one.",
      );
      return;
    }
    addInstance({
      nodeTemplateId,
      name,
      kind: null,
      icon: null,
      isBuiltin,
      catalogKey,
    });
  };

  /**
   * A New-node tile (Phase 2): place an in-memory draft instance of the kind —
   * `nodeTemplateId: "draft:<n>"`, def in pendingDefs. No POST at click time:
   * nothing server-side exists until Save (abandoned placements never pollute
   * the catalog). The def carries the kind's boilerplate (§8 — the node is
   * ready to run as-is; the drawer's knob edits and input remaps are the only
   * work), so the drawer/canvas see a working node immediately.
   */
  const addDraftKindNode = (kind: "agent" | "decision" | "http" | "script") => {
    if (!draft) return;
    const draftId = `draft:${draftSeq.current++}`;
    const name = nextDraftName(kind, draft);
    // the kind's boilerplate — the def carries it (the row born at Save) and
    // the instance config mirrors it (the drawer/canvas contract reads the
    // instance config; identical values keep the def the source of truth)
    const config = boilerplateFor(kind);
    addInstance({
      nodeTemplateId: draftId,
      name,
      kind,
      icon: KIND_ICONS[kind] ?? "bot",
      isBuiltin: false,
      config,
      draftDef: {
        draftId,
        kind,
        name,
        icon: KIND_ICONS[kind] ?? "bot",
        description: NODE_KIND_DESCRIPTIONS[kind],
        config,
      },
    });
  };

  // ── node placement for palette additions ──────────────────────────────────
  const placeNewNode = (key: string): Position => {
    let pos: Position;
    if (draft && draft.nodes.length === 0) {
      pos = { x: 320, y: 320 };
    } else if (
      builderApi.current?.screenToFlowPosition &&
      typeof window !== "undefined"
    ) {
      const center = builderApi.current.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
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
        {error ? (
          <Alert variant="destructive">
            {error} —{" "}
            <Link href="/templates" className="underline">
              back to gallery
            </Link>
          </Alert>
        ) : (
          <Spinner />
        )}{" "}
        Loading…
      </main>
    );
  }

  const readonly = draft.template.is_builtin;
  const configuring =
    nodeDrawer != null
      ? (draft.nodes.find((n) => n.key === nodeDrawer) ?? null)
      : null;
  const editingEdge =
    edgeDrawer != null ? (draft.edges[edgeDrawer] ?? null) : null;
  // the template's declared task type (trigger.task_type — the Task context
  // panel edits it): the provider's contextFields become the {{task.*}} chips
  // every node configurator offers, and the start node's contract seeder
  const taskType = String(
    draft.template.trigger?.task_type ?? providers[0]?.kind ?? "",
  );
  const taskProvider =
    providers.find((p) => p.kind === taskType) ?? providers[0] ?? null;
  const taskFields = taskProvider?.contextFields ?? [];
  // connection info for the configured node: incoming edges resolve to the
  // Inputs tab's upstream pickers; an isolated node can't be configured yet
  const relationships = nodeRelationships(draft.nodes, draft.edges);
  const configuringLocked =
    configuring != null
      ? (relationships[configuring.key]?.isolated ?? false)
      : false;
  const configuringIncoming: IncomingLink[] = configuring
    ? draft.edges
        .map((edge, edgeIndex) => ({
          edge,
          edgeIndex,
          source: draft.nodes.find((n) => n.key === edge.from) ?? null,
        }))
        .filter((l) => l.edge.to === configuring.key && l.source)
    : [];
  // the fan-out gate (save-time lint rule 1, mirrored): the Fanout config
  // section only applies to nodes a plan node reaches through next edges
  const configuringPlanDownstream = configuring
    ? isPlanDownstream(draft.nodes, draft.edges, configuring.key)
    : true;

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
            {readonly ? (
              <Badge className="bg-info/10 text-info">
                <Lock size={9} className="mr-0.5" />
                built-in
              </Badge>
            ) : null}
            <Badge variant="outline" className="text-[10px]">
              v{draft.template.version}
            </Badge>
          </h1>
          <p className="text-muted-foreground text-[11px] m-0">
            {draft.nodes.length} node{draft.nodes.length === 1 ? "" : "s"} ·{" "}
            {draft.edges.length} edge{draft.edges.length === 1 ? "" : "s"}
            {(layoutSync === "pending" || layoutSync === "saved") && (
              <span>
                {" "}
                ·{" "}
                {layoutSync === "pending"
                  ? "saving layout…"
                  : "layout autosaved"}
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
            <Link href="/templates" className="underline">
              duplicate in the gallery
            </Link>{" "}
            to edit
          </span>
        ) : null}
        {!readonly && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
          >
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
          <Button
            size="sm"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? <Spinner /> : <Save size={13} />} Save{dirty ? "" : "d"}
          </Button>
        )}
      </header>

      {/* ── floating notices ── */}
      {(error || notice) && (
        <div className="absolute top-16 inset-x-4 z-40 flex justify-center pointer-events-none">
          <Alert
            variant={error ? "destructive" : "default"}
            className={cn(
              "max-w-[640px] pointer-events-auto shadow-lg",
              error && "w-auto",
            )}
          >
            <span>{error ?? notice}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto text-muted-foreground hover:text-foreground"
              title="Dismiss"
              onClick={() => {
                setError(null);
                setNotice(null);
              }}
            >
              <X size={14} />
            </Button>
          </Alert>
        </div>
      )}

      {/* ── the canvas + node palette ── */}
      <div className="flex-1 min-h-0 flex">
        <NodePalette
          templateId={draft.template.id}
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
            nodeProblems={nodeProblems}
            edgeProblems={edgeProblems}
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
            onNodeMove={(key, x, y) =>
              setPositions((p) => ({ ...p, [key]: { x, y } }))
            }
            onNodeDragStop={schedulePositionsSave}
            onConnect={addEdge}
            onNodeRemove={removeNodeKey}
            onEdgeRemove={removeEdge}
            onNodeDuplicate={duplicateNode}
            onTidyLayout={tidyLayout}
            onPaneClick={() => {
              setNodeDrawer(null);
              setEdgeDrawer(null);
              setPlacedKey(null);
            }}
            onApi={(api) => {
              builderApi.current = api;
            }}
          />
        </div>
      </div>

      {/* ── node drawer ── */}
      <Sheet
        open={configuring != null}
        onOpenChange={(v) => {
          if (!v) setNodeDrawer(null);
        }}
      >
        {configuring && (
          <SheetContent className="w-[640px] max-w-[calc(100vw-18rem)]">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {configuring.overrideLabel ||
                  configuring.catalog_name ||
                  configuring.key}
                <Badge variant="outline">{configuring.kind ?? "builtin"}</Badge>
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2 flex-wrap">
                <code className="font-mono">{configuring.key}</code>
                <span>·</span>
                <span>{describeTrigger(configuring.trigger)}</span>
                {configuring.join_mode === "any" && (
                  <Badge className="bg-warning/10 text-warning text-[10px] py-0">
                    any-join
                  </Badge>
                )}
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              <div className="grid gap-1 mb-4">
                <Label>Display name</Label>
                <Input
                  value={configuring.overrideLabel ?? ""}
                  disabled={readonly}
                  placeholder={configuring.catalog_name ?? configuring.key}
                  onChange={(e) =>
                    patchNode(configuring.key, {
                      overrideLabel: e.target.value || null,
                    })
                  }
                />
              </div>
              <NodeConfiguratorBody
                node={configuring}
                incoming={configuringIncoming}
                locked={configuringLocked}
                planDownstream={configuringPlanDownstream}
                taskFields={taskFields}
                triggerFields={triggerFields}
                invalidRefs={refProblems[configuring.key]}
                templateId={draft.template.id}
                problems={nodeProblems[configuring.key]}
                onChange={(patch) => {
                  const next = { ...configuring, ...patch };
                  setDraft((cur) =>
                    cur
                      ? {
                          ...cur,
                          nodes: cur.nodes.map((p) =>
                            p.key === next.key ? next : p,
                          ),
                        }
                      : cur,
                  );
                  setDirty(true);
                  setNotice(null);
                }}
              />
            </SheetBody>
            <SheetFooter>
              {!readonly && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive mr-auto"
                  onClick={() => removeNode(configuring)}
                >
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
        <Sheet
          open={editingEdge != null}
          onOpenChange={(v) => {
            if (!v) setEdgeDrawer(null);
          }}
        >
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
                templateId={draft.template.id}
                taskFields={taskFields}
                triggerFields={triggerFields}
                onChange={(patch) => {
                  if (edgeDrawer == null || !draft) return;
                  const next = {
                    ...draft,
                    edges: draft.edges.map((e, i) =>
                      i === edgeDrawer ? { ...e, ...patch } : e,
                    ),
                  };
                  apply(next);
                }}
                sourceNode={
                  draft.nodes.find((n) => n.key === editingEdge.from) ?? null
                }
              />
            </SheetBody>
            <SheetFooter>
              {!readonly && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive mr-auto"
                  onClick={() => removeEdge(edgeDrawer!)}
                >
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
              <Settings2 size={14} className="text-muted-foreground" /> Flow
              settings
            </SheetTitle>
            <SheetDescription>
              Template meta + how flows start from it.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <SettingsBody
              draft={draft}
              readonly={readonly}
              hook={hook}
              providers={providers}
              repos={repos}
              templateId={draft.template.id}
              onChange={(t) =>
                apply({ ...draft, template: { ...draft.template, ...t } })
              }
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
      // validate before PATCH (Phase 5): the same structured lint the live
      // validation runs — problems block the save and land on their node /
      // edge as badges, instead of one concatenated wall of save errors
      const problems = await validateDraft(draft);
      if (problems.length) {
        setError(problemsMessage(problems));
        return;
      }
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
          edges: draft.edges.map((e) => ({
            from: e.from,
            to: e.to,
            kind: e.kind,
            label: e.label,
            condition: e.condition,
          })),
        }),
      }).then((r) => r.json());
      if (r.error) setError(r.error);
      else {
        setDirty(false);
        setNotice("Draft saved — new flows snapshot this version.");
        setNodeProblems({});
        setEdgeProblems({});
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
  return (
    <span className="text-[11px] text-muted-foreground sm:mr-2">
      Esc closes · edits live on the canvas draft
    </span>
  );
}

// ── edge editor ──────────────────────────────────────────────────────────────

function EdgeEditor({
  edge,
  draft,
  readonly,
  onChange,
  sourceNode,
  templateId,
  taskFields,
  triggerFields,
}: {
  edge: EditorEdge;
  index: number;
  draft: Draft;
  readonly: boolean;
  onChange: (patch: Partial<EditorEdge>) => void;
  sourceNode: EditorNode | null;
  /** the owning template's id (Phase 5) — the condition's live preview */
  templateId: string;
  /** the {{task.*}} / {{trigger.payload.*}} vocabulary (Phase 3) — the
   *  condition builder's variable lists (an edge condition sees the whole
   *  flow context, not just the source node's output) */
  taskFields: { key: string; label?: string; type?: string }[];
  triggerFields: { key: string; label?: string; type?: string }[];
}) {
  const isDecision = sourceNode?.kind === "decision";
  // decision sources: the edge label must be one of the decision's choices —
  // quick-picks from the contract. Non-decision sources: the contract still
  // resolves — its published fields are the nodes.<key>.output.* paths the
  // condition builder offers (the source node is finished when it's traversed).
  const [contract, setContract] = useState<NodeContract | null>(null);
  useEffect(() => {
    if (!sourceNode) {
      setContract(null);
      return;
    }
    let alive = true;
    fetch(contractsUrl(sourceNode))
      .then((r) => r.json())
      .then((c: NodeContract) => {
        if (alive) setContract(c?.input != null ? c : null);
      })
      .catch(() => alive && setContract(null));
    return () => {
      alive = false;
    };
  }, [
    sourceNode?.key,
    sourceNode?.nodeTemplateId,
    sourceNode?.config,
    sourceNode?.kind,
  ]);

  // the condition's vocabulary: task context → the source node's published
  // outputs → trigger payload → flow & repo (no "my inputs" — the context map
  // has no input root at edge-traversal time)
  const condGroups = useMemo(() => {
    const upstream = sourceNode
      ? [
          {
            key: sourceNode.key,
            label: nodeLabel(sourceNode),
            fields: schemaRows(contract?.output ?? null).map((f) => ({
              name: f.name,
              type: f.type,
            })),
          },
        ]
      : [];
    return asJsonataGroups(
      conditionVarGroups(
        buildVarGroups({ taskFields, triggerFields, upstream }),
      ),
    );
  }, [sourceNode, contract, taskFields, triggerFields]);
  const choices = isDecision
    ? ((
        contract as
          | (NodeContract & {
              choices?: { label: string; description?: string }[];
            })
          | null
      )?.choices ?? [])
    : null;

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label>From</Label>
          <EdgeSelect
            value={edge.from}
            nodes={draft.nodes}
            disabled={readonly}
            onChange={(v) => onChange({ from: v })}
          />
        </div>
        <div className="grid gap-1">
          <Label>To</Label>
          <EdgeSelect
            value={edge.to}
            nodes={draft.nodes}
            disabled={readonly}
            onChange={(v) => onChange({ to: v })}
          />
        </div>
      </div>
      <div className="grid gap-1">
        <Label>Kind</Label>
        <Select
          value={edge.kind}
          disabled={readonly}
          onValueChange={(v) => {
            if (v != null) onChange({ kind: v });
          }}
        >
          <SelectTrigger className="w-full rounded-lg border-border bg-card">
            <SelectValue>
              {EDGE_KIND_OPTIONS[edge.kind]?.label ?? edge.kind}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {EDGE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                <SelectOption
                  label={EDGE_KIND_OPTIONS[k]?.label ?? k}
                  description={EDGE_KIND_OPTIONS[k]?.description ?? ""}
                />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground m-0">
          {edge.kind === "loop"
            ? "Loop edges re-trigger the target once it has finished (bounds come from the target's max-attempt knobs)."
            : "A plain forward edge."}
        </p>
      </div>
      <div className="grid gap-1">
        <Label>
          Label{" "}
          {isDecision && (
            <span className="text-warning">
              — required for decision branches
            </span>
          )}
        </Label>
        {isDecision && choices && choices.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {choices.map((c) => (
              <Button
                key={c.label}
                disabled={readonly}
                title={c.description}
                onClick={() => onChange({ label: c.label })}
                variant="outline"
                size="xs"
                className={cn(
                  "rounded-md text-[11.5px]",
                  edge.label === c.label
                    ? "border-violet-500 bg-violet-500/10 text-violet-300"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </Button>
            ))}
          </div>
        )}
        <Input
          value={edge.label ?? ""}
          placeholder={
            isDecision
              ? "a choice of the decision node"
              : "label (decision branch)"
          }
          disabled={readonly}
          onChange={(ev) => onChange({ label: ev.target.value || null })}
        />
      </div>
      <div className="grid gap-1.5">
        <label className="text-xs text-muted-foreground">
          Condition — when does this edge activate?
        </label>
        <ConditionBuilder
          value={edge.condition}
          varGroups={condGroups}
          templateId={templateId}
          scope="context"
          placeholder="nodes.build.output.mr_url"
          disabled={readonly}
          onChange={(raw) => onChange({ condition: raw })}
        />
        <p className="text-[11px] text-muted-foreground m-0">
          The edge activates only when the condition is truthy — empty means
          always. It&apos;s checked against the flow&apos;s context as the
          source node finishes.
        </p>
      </div>
    </div>
  );
}

function EdgeSelect({
  value,
  nodes,
  disabled,
  onChange,
}: {
  value: string;
  nodes: EditorNode[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (v != null) onChange(v);
      }}
    >
      <SelectTrigger className="w-full rounded-lg border-border bg-card font-mono">
        <SelectValue>{value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {nodes.map((n) => (
          <SelectItem key={n.key} value={n.key} className="font-mono">
            {nodeLabel(n)}
            {n.key !== nodeLabel(n) && (
              <span className="text-muted-foreground"> ({n.key})</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── flow settings body (grouped Phase 6: "When flows start" + Advanced) ──────

/**
 * Flow settings (Phase 6 grouping, F2): template meta, then the task context,
 * then "When flows start" (the flow trigger type + its repo/interval bindings)
 * — the webhook's JSONata filter and the inbound hook details live under
 * "Advanced", and the hook secret is masked with reveal/copy instead of
 * printed in plaintext.
 */
function SettingsBody({
  draft,
  readonly,
  hook,
  providers,
  repos,
  templateId,
  onChange,
}: {
  draft: Draft;
  readonly: boolean;
  hook: { id: string; secret: string; filter: string | null } | null;
  /** registered task providers (GET /api/tasks/providers) */
  providers: {
    kind: string;
    label: string;
    configured: boolean;
    contextFields: {
      key: string;
      label: string;
      type: string;
      required?: boolean;
    }[];
  }[];
  repos: any[];
  /** the owning template's id (Phase 5) — the filter's live preview */
  templateId: string;
  onChange: (t: Partial<Draft["template"]>) => void;
}) {
  const trigger = draft.template.trigger ?? {};
  const triggerType = String(trigger.type ?? "manual");
  const setTrigger = (patch: Record<string, unknown>) =>
    onChange({ trigger: { ...trigger, ...patch } });
  // the declared task type (Phase 3): which task type the template's flows run
  // on — its provider's contextFields are the {{task.*}} variables every node
  // maps against. Absent → the first registered provider (matching the store's
  // parse rule).
  const taskType = String(trigger.task_type ?? providers[0]?.kind ?? "");
  const taskProvider =
    providers.find((p) => p.kind === taskType) ?? providers[0] ?? null;
  const autoStarts = ["webhook", "schedule"].includes(triggerType);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <div className="grid gap-1">
          <Label>Template name</Label>
          <Input
            value={draft.template.name}
            disabled={readonly}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label>Description</Label>
          <Textarea
            value={draft.template.description ?? ""}
            rows={2}
            disabled={readonly}
            onChange={(e) => onChange({ description: e.target.value || null })}
            className="bg-card text-foreground border-border text-[13px] px-3 py-2 resize-y"
          />
        </div>
      </div>

      {/* ── Task context (Phase 3): the declared task type + its fields ── */}
      <div className="grid gap-1">
        <Label>Task context</Label>
        <Select
          value={taskType}
          disabled={readonly || providers.length === 0}
          onValueChange={(v) => setTrigger({ task_type: v || undefined })}
        >
          <SelectTrigger className="w-full rounded-lg border-border bg-card">
            <SelectValue placeholder="no task providers registered">
              {taskProvider
                ? `${taskProvider.label} (${taskProvider.kind})${taskProvider.configured ? "" : " — not configured"}`
                : "no task providers registered"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.kind} value={p.kind}>
                {p.label} ({p.kind}){p.configured ? "" : " — not configured"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          Flows started from this template run on a{" "}
          {taskProvider?.label ?? taskType} task — its fields (above) are
          available to every node as {"{{task.*}}"} variables, no wiring needed.
        </p>
      </div>

      {/* ── When flows start (Phase 6 grouping): the flow trigger + bindings ── */}
      <div className="grid gap-3">
        <div className="text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
          When flows start
        </div>
        <div className="grid gap-1">
          <Label>Flow trigger</Label>
          <Select
            value={triggerType}
            disabled={readonly}
            onValueChange={(v) => setTrigger({ type: v })}
          >
            <SelectTrigger className="w-full rounded-lg border-border bg-card">
              <SelectValue>
                {FLOW_TRIGGER_TYPE[triggerType] ?? triggerType}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FLOW_TRIGGER_TYPE).map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground m-0">
            {triggerType === "manual"
              ? "Started from the home page's task picker."
              : `Auto-creates flows — bind a repo below; each flow attaches the most recent imported ${taskType} task.`}
          </p>
        </div>
        {autoStarts && (
          <div className="grid gap-1">
            <Label>Bound repo</Label>
            <Select
              value={String(trigger.repo_id ?? "")}
              disabled={readonly}
              onValueChange={(v) => setTrigger({ repo_id: v || undefined })}
            >
              <SelectTrigger className="w-full rounded-lg border-border bg-card">
                <SelectValue>— pick a repo —</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— pick a repo —</SelectItem>
                {repos.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                    {r.local_path ? " (local)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {triggerType === "schedule" && (
          <div className="grid gap-1">
            <Label>Interval (minutes)</Label>
            <Input
              type="number"
              min={1}
              value={Number(trigger.interval_min ?? 60)}
              disabled={readonly}
              onChange={(e) =>
                setTrigger({
                  interval_min:
                    Number(e.target.value) > 0
                      ? Number(e.target.value)
                      : undefined,
                })
              }
            />
            <p className="text-[11px] text-muted-foreground m-0">
              One new flow per fire, started automatically from the repo binding
              above.
            </p>
          </div>
        )}
      </div>

      {/* ── Advanced (Phase 6 grouping): webhook filter + hook details ── */}
      {triggerType === "webhook" && (
        <Collapsible>
          <CollapsibleTrigger
            render={
              <button className="group flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px] hover:text-foreground transition-colors" />
            }
          >
            <ChevronRight className="size-3 transition-transform group-data-panel-open:rotate-90" />{" "}
            Advanced — delivery filter & hook details
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid gap-3 pt-2">
              <div className="grid gap-1">
                <Label>Filter — which deliveries start a flow?</Label>
                <ConditionBuilder
                  value={
                    typeof trigger.filter === "string" ? trigger.filter : null
                  }
                  templateId={templateId}
                  scope="delivery"
                  placeholder={"payload.event"}
                  disabled={readonly}
                  onChange={(raw) => setTrigger({ filter: raw || undefined })}
                />
                <p className="text-[11px] text-muted-foreground m-0">
                  The delivery starts a flow only when the filter is truthy —
                  empty means every delivery. It sees the delivery body (
                  <code className="font-mono">payload.*</code>) and headers.
                </p>
                {hook && (
                  <Card className="p-3 grid gap-1.5 mt-1">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
                      <WebhookIcon size={12} /> Inbound hook
                    </div>
                    <code className="font-mono text-[12px] break-all">
                      POST /api/hooks/{hook.id}
                    </code>
                    <MaskedSecret value={hook.secret} />
                    <code className="font-mono text-[12px] text-muted-foreground break-all">
                      {
                        'node scripts/send-hook.mjs <url> <secret> \'{"event":"issue.created"}\''
                      }
                    </code>
                    <p className="text-[11px] text-muted-foreground m-0">
                      Delivery body becomes{" "}
                      <code className="font-mono">{"{{trigger.payload}}"}</code>{" "}
                      in the flow&apos;s context. Save to apply filter changes.
                    </p>
                  </Card>
                )}
                {!hook && (
                  <p className="text-[11px] text-muted-foreground m-0">
                    The hook endpoint appears once the template is saved or
                    duplicated.
                  </p>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      {readonly && (
        <p className="text-[11.5px] text-muted-foreground m-0 flex items-start gap-1.5">
          <Lock size={12} className="mt-0.5 shrink-0" />
          Built-in templates are read-only. Use the gallery&apos;s duplicate
          action to make an editable copy.
        </p>
      )}
    </div>
  );
}

/**
 * The inbound hook's secret — masked by default (Phase 6): dots until the eye
 * is clicked, with a copy button that never needs the reveal.
 */
function MaskedSecret({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the reveal is the fallback */
    }
  };
  return (
    <span className="flex items-center gap-1 font-mono text-[12px] text-muted-foreground break-all">
      <span className="text-muted-foreground/70">secret</span>
      {revealed ? value : "•".repeat(Math.min(value.length || 8, 20))}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        title={revealed ? "Hide secret" : "Reveal secret"}
        onClick={() => setRevealed((v) => !v)}
      >
        {revealed ? <EyeOff size={11} /> : <Eye size={11} />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        title="Copy secret"
        onClick={() => void copy()}
      >
        {copied ? (
          <Check size={11} className="text-success" />
        ) : (
          <Copy size={11} />
        )}
      </Button>
    </span>
  );
}

function uniqueKey(base: string, nodes: EditorNode[]): string {
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "node";
  if (!nodes.some((n) => n.key === slug)) return slug;
  for (let i = 2; ; i++)
    if (!nodes.some((n) => n.key === `${slug}_${i}`)) return `${slug}_${i}`;
}

/** Display name for a placed draft def — "Agent node", then "Agent node 2", …
 *  avoiding collisions with this draft's other pending defs (the server
 *  versions the name further if a persisted row owns the key). */
function nextDraftName(kind: string, draft: Draft): string {
  const base = KIND_LABELS[kind] ?? "Custom node";
  const taken = new Set(
    Object.values(draft.pendingDefs ?? {}).map((d) => d.name),
  );
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
  draft_id: string;
  kind: string;
  name: string;
  icon: string | null;
  description: string | null;
  config: Record<string, unknown>;
}[] {
  const out: {
    draft_id: string;
    kind: string;
    name: string;
    icon: string | null;
    description: string | null;
    config: Record<string, unknown>;
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
