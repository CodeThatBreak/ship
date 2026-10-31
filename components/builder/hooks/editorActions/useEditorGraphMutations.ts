"use client";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { dagreLayout } from "@/components/templateEditor/layout";
import { nodeContractQueryOptions } from "@/components/templateEditor/queries";
import { nodeContractRequest } from "@/components/templateEditor/utils/contractRequest";
import { nodeLabel, type EditorNode } from "@/components/templateEditor/types";
import { START_NODE_TEMPLATE_ID, uniqueKey, type Draft } from "@/components/templateEditor/draft";
import { edgeDedupeKey } from "@/constants/templateGraph";
import type { EditorDraftContext } from "./types";

export const useEditorGraphMutations = ({
  machine,
  layout,
  drawers,
}: Pick<EditorDraftContext, "machine" | "layout" | "drawers">) => {
  const { draftRef, apply, setNotice } = machine;
  const { positions, setPositions, scheduleSave } = layout;
  const { setNodeDrawer, setEdgeDrawer, setPlacedKey } = drawers;
  const queryClient = useQueryClient();

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
        edges: d.edges.filter((e) => e.from !== node.key && e.to !== node.key),
      }));
      setNodeDrawer((open) => (open === node.key ? null : open));
      setPlacedKey((open) => (open === node.key ? null : open));
      setEdgeDrawer(null);
    },
    [draftRef, apply, setNotice, setNodeDrawer, setPlacedKey, setEdgeDrawer],
  );

  const removeNodeKey = useCallback(
    (key: string) => {
      const node = draftRef.current?.nodes.find((n) => n.key === key);
      if (node) removeNode(node);
    },
    [draftRef, removeNode],
  );

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
    [draftRef, apply, setEdgeDrawer],
  );

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

  const tidyLayout = useCallback(() => {
    const cur = draftRef.current;
    if (!cur || cur.template.is_builtin) return;
    setPositions((p) => ({ ...p, ...dagreLayout(cur.nodes, cur.edges) }));
    scheduleSave();
  }, [draftRef, setPositions, scheduleSave]);

  const autoLabelDecisionEdge = useCallback(
    async (from: string, to: string, edges: Draft["edges"]) => {
      const src = draftRef.current?.nodes.find((n) => n.key === from);
      if (src?.kind !== "decision") return;
      const request = nodeContractRequest(src);
      const contract = await queryClient
        .fetchQuery(nodeContractQueryOptions(request))
        .catch(() => null);
      const choices = contract?.choices ?? [];
      if (!choices.length) return;
      const used = new Set(
        edges.filter((e) => e.from === from && e.label).map((e) => e.label as string),
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

  const addEdge = useCallback(
    (from: string, to: string, branchLabel?: string | null) => {
      const cur = draftRef.current;
      if (!cur) return;
      const exists = cur.edges.some(
        (e) =>
          edgeDedupeKey(e.from, e.to, e.label) === edgeDedupeKey(from, to, branchLabel ?? null),
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
    [draftRef, apply, setNotice, autoLabelDecisionEdge, setEdgeDrawer],
  );

  return {
    removeNode,
    removeNodeKey,
    removeEdge,
    duplicateNode,
    addEdge,
    tidyLayout,
  };
};
