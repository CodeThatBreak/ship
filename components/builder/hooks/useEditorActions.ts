"use client";
/**
 * The editor's placement/edit action bundle (page-local, the template editor
 * route's own behaviors): palette placements, node/edge removal, duplication,
 * decision-branch auto-labeling on connect and "Tidy layout".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorGraphMutations } from "./editorActions/useEditorGraphMutations";
import { useEditorNodePlacement } from "./editorActions/useEditorNodePlacement";
import type { EditorActionsApi, EditorActionsDeps } from "./editorActions/types";

export type { DraftKind, EditorActionsApi, EditorActionsDeps } from "./editorActions/types";

export const useEditorActions = (deps: EditorActionsDeps): EditorActionsApi => {
  const { machine, layout, builderApi, drawerCloser } = deps;

  const [nodeDrawer, setNodeDrawer] = useState<string | null>(null);
  const [edgeDrawer, setEdgeDrawer] = useState<number | null>(null);
  const [placedKey, setPlacedKey] = useState<string | null>(null);
  const draftSeq = useRef(1);

  const closeAll = useCallback(() => {
    setNodeDrawer(null);
    setEdgeDrawer(null);
    setPlacedKey(null);
  }, []);

  useEffect(() => {
    drawerCloser.current = closeAll;
    return () => {
      drawerCloser.current = () => {};
    };
  }, [drawerCloser, closeAll]);

  const drawers = {
    nodeDrawer,
    setNodeDrawer,
    edgeDrawer,
    setEdgeDrawer,
    placedKey,
    setPlacedKey,
    closeAll,
  };

  const graph = useEditorGraphMutations({ machine, layout, drawers });
  const placement = useEditorNodePlacement({
    machine,
    layout,
    builderApi,
    drawers,
    draftSeq,
  });

  return useMemo(
    () => ({
      nodeDrawer,
      setNodeDrawer,
      edgeDrawer,
      setEdgeDrawer,
      placedKey,
      setPlacedKey,
      closeAll,
      ...graph,
      ...placement,
    }),
    [nodeDrawer, edgeDrawer, placedKey, closeAll, graph, placement],
  );
};
