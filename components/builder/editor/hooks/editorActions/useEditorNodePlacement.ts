"use client";
import { useCallback } from "react";
import { boilerplateFor, NODE_KIND_DESCRIPTIONS } from "@/components/templateEditor/boilerplate";
import { KIND_ICONS, nextDraftName, START_NODE_TEMPLATE_ID, uniqueKey } from "@/components/templateEditor/draft";
import { CATALOG_KEY } from "@/constants/nodeKind";
import {
  DEFAULT_NEW_NODE_NAME,
  DEFAULT_NODE_ICON,
  DRAFT_ID_PREFIX,
  EDITOR_NODE_KIND,
  TRIGGER_TYPE,
} from "../../constants/editorGraph";
import { EDITOR_MESSAGES } from "../../constants/editorMessages";
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
      const key = uniqueKey(opts.name || DEFAULT_NEW_NODE_NAME, cur.nodes);
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
            trigger: { type: TRIGGER_TYPE.AUTO },
            joinMode: EDITOR_NODE_KIND.ALL_JOIN,
            config: opts.config ?? {},
            inputMap: {},
            kind: opts.kind,
            icon: opts.icon,
            catalogName: opts.name,
            catalogKey: opts.catalogKey ?? null,
            isBuiltin: opts.isBuiltin,
          },
        ],
      }));
      setNodeDrawer(null);
      setPlacedKey(key);
      setNotice(EDITOR_MESSAGES.NODE_PLACED);
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
        setNotice(EDITOR_MESSAGES.duplicateCatalogNode(name));
        return;
      }
      if (
        catalogKey === CATALOG_KEY.START &&
        cur.nodes.some((n) => n.nodeTemplateId === START_NODE_TEMPLATE_ID)
      ) {
        setNotice(EDITOR_MESSAGES.START_NODE_ALREADY_PRESENT);
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
      const draftId = `${DRAFT_ID_PREFIX}${draftSeq.current++}`;
      const name = nextDraftName(kind, cur);
      const config = boilerplateFor(kind);
      void addInstance({
        nodeTemplateId: draftId,
        name,
        kind,
        icon: KIND_ICONS[kind] ?? DEFAULT_NODE_ICON,
        isBuiltin: false,
        config,
        draftDef: {
          draftId,
          kind,
          name,
          icon: KIND_ICONS[kind] ?? DEFAULT_NODE_ICON,
          description: NODE_KIND_DESCRIPTIONS[kind],
          config,
        },
      });
    },
    [draftRef, addInstance, draftSeq],
  );

  return { addCatalogNode, addKindNode };
};
