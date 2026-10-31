"use client";
import { useCallback } from "react";
import {
  boilerplateFor,
  KIND_ICONS,
  nextDraftName,
  NODE_KIND_DESCRIPTIONS,
  START_NODE_TEMPLATE_ID,
  uniqueKey,
} from "@/components/template-editor";
import { placeNewNodeIntoLayout } from "./placeNewNodeIntoLayout";
import type { DraftKind, EditorDraftContext, PlacementOpts } from "./types";

export const useEditorNodePlacement = ({
  machine,
  layout,
  builderApi,
  drawers,
  draftSeq,
}: EditorDraftContext) => {
  const { draftRef, apply, setNotice } = machine;
  const { setPositions } = layout;
  const { setNodeDrawer, setPlacedKey } = drawers;

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
    [draftRef, apply, builderApi, setPositions, setNotice, setNodeDrawer, setPlacedKey],
  );

  const addCatalogNode = useCallback(
    (
      nodeTemplateId: string,
      isBuiltin: boolean,
      catalogKey: string,
      name: string,
    ) => {
      const cur = draftRef.current;
      if (!cur) return;
      if (isBuiltin && cur.nodes.some((n) => n.nodeTemplateId === nodeTemplateId)) {
        setNotice(`Only one "${name}" node is allowed — this template already has one.`);
        return;
      }
      if (
        catalogKey === "start" &&
        cur.nodes.some((n) => n.nodeTemplateId === START_NODE_TEMPLATE_ID)
      ) {
        setNotice("Only one Start node is allowed — this template already has one.");
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

  const addKindNode = useCallback(
    (kind: DraftKind) => {
      const cur = draftRef.current;
      if (!cur) return;
      const draftId = `draft:${draftSeq.current++}`;
      const name = nextDraftName(kind, cur);
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
    [draftRef, addInstance, draftSeq],
  );

  return { addCatalogNode, addKindNode };
};
