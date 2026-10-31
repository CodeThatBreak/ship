"use client";
/**
 * The editor's placement/edit action bundle (page-local, the template editor
 * route's own behaviors): palette placements (catalog rows + New-node tiled
 * drafts), node/edge removal, duplication, decision-branch auto-labeling on
 * connect and "Tidy layout". Structural edits flow through the draft
 * machine's `apply` (snapshots for undo); nothing here hits the server
 * except the decision contract read that labels a new branch edge — shared
 * TanStack cache with the canvas's branch handles.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  boilerplateFor,
  dagreLayout,
  KIND_ICONS,
  NODE_KIND_DESCRIPTIONS,
  nextDraftName,
  nodeLabel,
  contractsUrl,
  nodeContractQueryOptions,
  uniqueKey,
  START_NODE_TEMPLATE_ID,
  type BuilderApi,
  type Draft,
  type DraftNodeDef,
  type EditorNode,
  type NodePositionsApi,
  type TemplateDraftMachine,
  type CanvasPosition,
} from "@/components/template-editor";
import { edgeDedupeKey } from "@/constants/template-graph";

/** Draft instance ids never collide within a session (monotonic). */
export type DraftKind = "agent" | "decision" | "http" | "script";

/** Placement opts for one new node instance (a catalog row or a draft). */
interface PlacementOpts {
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
  /** the backing row's catalog key ("plan", "start", ...) — the fan-out
   *  configurator's plan-downstream gate reads it */
  catalogKey?: string | null;
}

export interface EditorActionsDeps {
  machine: TemplateDraftMachine;
  layout: NodePositionsApi;
  /** the canvas's screen→flow helper (palette placements go to viewport center) */
  builderApi: React.RefObject<BuilderApi | null>;
  /** undo/redo may invalidate the open drawers — this ref receives `closeAll` */
  drawerCloser: React.RefObject<() => void>;
}

export interface EditorActionsApi {
  /** the node configurator drawer's open node key (also the canvas selection) */
  nodeDrawer: string | null;
  setNodeDrawer: (next: string | null) => void;
  /** the edge drawer's open edge index */
  edgeDrawer: number | null;
  setEdgeDrawer: (next: number | null) => void;
  /** the just-placed node (canvas selection highlight while no drawer is open) */
  placedKey: string | null;
  setPlacedKey: (next: string | null) => void;
  /** close every drawer + selection (pane clicks, history jumps) */
  closeAll: () => void;
  removeNode: (node: EditorNode) => void;
  removeNodeKey: (key: string) => void;
  removeEdge: (index: number) => void;
  duplicateNode: (key: string) => void;
  addEdge: (from: string, to: string, branchLabel?: string | null) => void;
  tidyLayout: () => void;
  addCatalogNode: (
    nodeTemplateId: string,
    isBuiltin: boolean,
    catalogKey: string,
    name: string,
  ) => void;
  addKindNode: (kind: DraftKind) => void;
}

export function useEditorActions(deps: EditorActionsDeps): EditorActionsApi {
  const { machine, layout, builderApi, drawerCloser } = deps;
  const { draftRef, apply, setNotice } = machine;
  const { positions, setPositions, scheduleSave } = layout;
  const queryClient = useQueryClient();

  // drawers: node configurator, edge editor, just-placed selection
  const [nodeDrawer, setNodeDrawer] = useState<string | null>(null);
  const [edgeDrawer, setEdgeDrawer] = useState<number | null>(null);
  /** the just-placed node (canvas selection highlight while no drawer is open) */
  const [placedKey, setPlacedKey] = useState<string | null>(null);
  /** monotonically growing — draft ids never collide within a session */
  const draftSeq = useRef(1);

  const closeAll = useCallback(() => {
    setNodeDrawer(null);
    setEdgeDrawer(null);
    setPlacedKey(null);
  }, []);

  // undo/redo restores a draft whose nodes/edges may differ — stale drawers
  // would edit the wrong element (closed via the machine's history jump)
  useEffect(() => {
    drawerCloser.current = closeAll;
    return () => {
      drawerCloser.current = () => {};
    };
  }, [drawerCloser, closeAll]);

  /** Removes a node and any edges touching it (footer button + keyboard
   *  deletes both land here). The Start node is protected — it's the flow's
   *  entry; delete its outgoing edges instead to strand a branch. */
  const removeNode = useCallback(
    (node: EditorNode) => {
      const cur = draftRef.current;
      if (!cur) return;
      if (node.nodeTemplateId === START_NODE_TEMPLATE_ID) {
        setNotice(
          "The Start node can't be deleted — it's the flow's entry. Rewire its edges instead.",
        );
        return;
      }
      apply((d) => ({
        ...d,
        nodes: d.nodes.filter((n) => n.key !== node.key),
        edges: d.edges.filter(
          (e) => e.from !== node.key && e.to !== node.key,
        ),
      }));
      setNodeDrawer((open) => (open === node.key ? null : open));
      setPlacedKey((open) => (open === node.key ? null : open));
      setEdgeDrawer(null);
    },
    [draftRef, apply, setNotice],
  );

  /** Keyboard-delete path from the canvas (BuilderCanvas resolves the id). */
  const removeNodeKey = useCallback(
    (key: string) => {
      const node = draftRef.current?.nodes.find((n) => n.key === key);
      if (node) removeNode(node);
    },
    [draftRef, removeNode],
  );

  /** Removes an edge by draft index (footer button + keyboard deletes —
   *  BuilderCanvas resolves the flow edge id `edge<i>` to this index). */
  const removeEdge = useCallback(
    (index: number) => {
      if (!draftRef.current) return;
      apply((d) => ({
        ...d,
        edges: d.edges.filter((_, i) => i !== index),
      }));
      setEdgeDrawer((cur) =>
        cur == null ? cur : cur === index ? null : cur > index ? cur - 1 : cur,
      );
    },
    [draftRef, apply],
  );

  /** Right-click → Duplicate node (Phase 6, G3): a fresh unique key, the
   *  config copied, placed unconnected near the original. The Start node is
   *  a singleton — duplicating it is refused (the palette enforces the same).
   *  Draft instances share their pending def — nothing extra to carry. */
  const duplicateNode = useCallback(
    (key: string) => {
      const cur = draftRef.current;
      if (!cur) return;
      const src = cur.nodes.find((n) => n.key === key);
      if (!src) return;
      if (src.nodeTemplateId === START_NODE_TEMPLATE_ID || src.is_builtin) {
        setNotice(
          src.is_builtin
            ? "Built-in nodes can't be duplicated — add at most one from the palette."
            : "Only one Start node is allowed — this template already has one.",
        );
        return;
      }
      const newKey = uniqueKey(
        `${src.overrideLabel || src.catalog_name || src.key} copy`,
        cur.nodes,
      );
      const pos = positions[key] ?? { x: 0, y: 0 };
      apply((d) => ({
        ...d,
        nodes: [
          ...d.nodes,
          {
            ...src,
            key: newKey,
            label: newKey,
            overrideLabel: `${nodeLabel(src)} copy`,
          },
        ],
      }));
      setPositions((p) => ({ ...p, [newKey]: { x: pos.x + 44, y: pos.y + 44 } }));
      scheduleSave();
      setNotice("Node duplicated — drag from one of its handles to connect it.");
    },
    [draftRef, apply, positions, setPositions, scheduleSave, setNotice],
  );

  /** "Tidy layout" (Phase 6, G2): dagre over the draft graph, then the usual
   *  debounced positions autosave (a tidy is just many drags at once). */
  const tidyLayout = useCallback(() => {
    const cur = draftRef.current;
    if (!cur || cur.template.is_builtin) return;
    setPositions((p) => ({ ...p, ...dagreLayout(cur.nodes, cur.edges) }));
    scheduleSave();
  }, [draftRef, setPositions, scheduleSave]);

  /** Decision branches: fetch the decision's choices (TanStack cache) and
   *  label the new edge with the first choice no sibling edge uses yet — the
   *  outgoing edges then read as the branches they carry. Silent on failure
   *  (label stays editable in the edge drawer). */
  const autoLabelDecisionEdge = useCallback(
    async (from: string, to: string, edges: Draft["edges"]) => {
      const src = draftRef.current?.nodes.find((n) => n.key === from);
      if (src?.kind !== "decision") return;
      const url = contractsUrl(src);
      const contract = await queryClient
        .fetchQuery(nodeContractQueryOptions(url))
        .catch(() => null);
      const choices = contract?.choices ?? [];
      if (!choices.length) return;
      const used = new Set(
        edges
          .filter((e) => e.from === from && e.label)
          .map((e) => e.label as string),
      );
      const label = choices.find((ch) => !used.has(ch.label))?.label;
      if (!label) return;
      apply((cur) => ({
        ...cur,
        edges: cur.edges.map((e) =>
          e.from === from && e.to === to && !e.label ? { ...e, label } : e,
        ),
      }));
    },
    [draftRef, queryClient, apply],
  );

  /** A new edge from the canvas. From a decision node's branch handle the
   *  edge arrives pre-labeled with that branch — attach-only wiring, no edge
   *  editing (the drawer stays closed); any other connect opens the drawer to
   *  finish it, and decision sources still auto-pick a free branch label. */
  const addEdge = useCallback(
    (from: string, to: string, branchLabel?: string | null) => {
      const cur = draftRef.current;
      if (!cur) return;
      const exists = cur.edges.some(
        (e) => edgeDedupeKey(e.from, e.to, e.label) === edgeDedupeKey(from, to, branchLabel ?? null),
      );
      if (exists) {
        setNotice(`Nodes are already connected (${from} → ${to}).`);
        return;
      }
      let nextEdgeCount = 0;
      apply((d) => {
        const nextEdges: Draft["edges"] = [
          ...d.edges,
          { from, to, kind: "next", label: branchLabel ?? null, condition: null },
        ];
        nextEdgeCount = nextEdges.length;
        return { ...d, edges: nextEdges };
      });
      if (!branchLabel) {
        setEdgeDrawer(nextEdgeCount - 1);
        const edgesAfter = draftRef.current?.edges;
        if (edgesAfter) void autoLabelDecisionEdge(from, to, edgesAfter);
      }
    },
    [draftRef, apply, setNotice, autoLabelDecisionEdge],
  );

  /** Build + place a new node instance (palette pick): viewport center,
   *  selected, deliberately unconnected — nothing is wired or opened for the
   *  user (auto-connecting pre-wired branches the user then had to unwind was
   *  the top daily annoyance). The hint names the connect gesture: drag from
   *  a node's handle. Config happens when the user opens the drawer. */
  const addInstance = useCallback(
    (opts: PlacementOpts): string | null => {
      const cur = draftRef.current;
      if (!cur) return null;
      const key = uniqueKey(opts.name || "node", cur.nodes);
      placeNewNodeIntoLayout(key, cur, builderApi, setPositions);
      apply((d) => ({
        ...d,
        pendingDefs: opts.draftDef
          ? { ...d.pendingDefs, [opts.draftDef.draftId]: opts.draftDef }
          : d.pendingDefs,
        nodes: [
          ...d.nodes,
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
      }));
      setNodeDrawer(null);
      setPlacedKey(key);
      setNotice("Node placed — drag from one of its handles to connect it.");
      return key;
    },
    [draftRef, apply, builderApi, setPositions, setNotice],
  );

  /** A palette pick: place an instance of the catalog row on the canvas
   *  (unconnected, at the viewport center — addInstance does the placing).
   *  Built-in rows and Library rows are persisted — the instance references
   *  the real row; no draft def involved. */
  const addCatalogNode = useCallback(
    (
      nodeTemplateId: string,
      isBuiltin: boolean,
      catalogKey: string,
      name: string,
    ) => {
      const cur = draftRef.current;
      if (!cur) return;
      if (
        isBuiltin &&
        cur.nodes.some((n) => n.nodeTemplateId === nodeTemplateId)
      ) {
        setNotice(`Only one "${name}" node is allowed — this template already has one.`);
        return;
      }
      if (
        catalogKey === "start" &&
        cur.nodes.some((n) => n.nodeTemplateId === START_NODE_TEMPLATE_ID)
      ) {
        setNotice(
          "Only one Start node is allowed — this template already has one.",
        );
        return;
      }
      void addInstance({
        nodeTemplateId,
        name,
        kind: null,
        icon: null,
        isBuiltin,
        catalogKey,
      });
    },
    [draftRef, addInstance, setNotice],
  );

  /**
   * A New-node tile (Phase 2): place an in-memory draft instance of the kind —
   * `nodeTemplateId: "draft:<n>"`, def in pendingDefs. No POST at click time:
   * nothing server-side exists until Save (abandoned placements never pollute
   * the catalog). The def carries the kind's boilerplate (§8 — the node is
   * ready to run as-is; the drawer's knob edits and input remaps are the only
   * work), so the drawer/canvas see a working node immediately.
   */
  const addKindNode = useCallback(
    (kind: DraftKind) => {
      const cur = draftRef.current;
      if (!cur) return;
      const draftId = `draft:${draftSeq.current++}`;
      const name = nextDraftName(kind, cur);
      // the kind's boilerplate — the def carries it (the row born at Save) and
      // the instance config mirrors it (the drawer/canvas contract reads the
      // instance config; identical values keep the def the source of truth)
      const config = boilerplateFor(kind);
      void addInstance({
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
    },
    [draftRef, addInstance],
  );

  return {
    nodeDrawer,
    setNodeDrawer,
    edgeDrawer,
    setEdgeDrawer,
    placedKey,
    setPlacedKey,
    closeAll,
    removeNode,
    removeNodeKey,
    removeEdge,
    duplicateNode,
    addEdge,
    tidyLayout,
    addCatalogNode,
    addKindNode,
  };
}

/** ── node placement for palette additions ────────────────────────────────
 *  A new node lands at the viewport center when the canvas reports its
 *  screen→flow helper; a template's first node centers in the empty canvas
 *  at a fixed offset instead. */
function placeNewNodeIntoLayout(
  key: string,
  draft: Draft,
  builderApi: React.RefObject<BuilderApi | null>,
  setPositions: (next: Record<string, CanvasPosition> | ((cur: Record<string, CanvasPosition>) => Record<string, CanvasPosition>)) => void,
): CanvasPosition {
  let pos: CanvasPosition;
  if (draft.nodes.length === 0) {
    pos = { x: 320, y: 320 };
  } else if (builderApi.current?.screenToFlowPosition && typeof window !== "undefined") {
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
}
