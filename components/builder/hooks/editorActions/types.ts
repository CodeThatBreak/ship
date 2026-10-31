import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { BuilderApi } from "@/components/templateEditor/BuilderCanvas";
import type { Draft } from "@/components/templateEditor/draft";
import type { DraftNodeDef, EditorNode } from "@/components/templateEditor/types";
import type { NodePositionsApi } from "@/components/templateEditor/hooks/useNodePositions";
import type { TemplateDraftMachine } from "@/components/templateEditor/hooks/useTemplateDraft";

import type { NodeKind } from "@/constants/nodeKind";

/** Draft instance ids never collide within a session (monotonic). */
export type DraftKind = NodeKind;

/** Placement opts for one new node instance (a catalog row or a draft). */
export interface PlacementOpts {
  nodeTemplateId: string;
  name: string;
  kind: string | null;
  icon: string | null;
  isBuiltin: boolean;
  draftDef?: DraftNodeDef;
  config?: Record<string, unknown>;
  catalogKey?: string | null;
}

export interface EditorActionsDeps {
  machine: TemplateDraftMachine;
  layout: NodePositionsApi;
  builderApi: RefObject<BuilderApi | null>;
  drawerCloser: RefObject<() => void>;
}

export interface EditorActionsApi {
  nodeDrawer: string | null;
  setNodeDrawer: (next: string | null) => void;
  edgeDrawer: number | null;
  setEdgeDrawer: (next: number | null) => void;
  placedKey: string | null;
  setPlacedKey: (next: string | null) => void;
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

export interface EditorDrawerState {
  nodeDrawer: string | null;
  setNodeDrawer: Dispatch<SetStateAction<string | null>>;
  edgeDrawer: number | null;
  setEdgeDrawer: Dispatch<SetStateAction<number | null>>;
  placedKey: string | null;
  setPlacedKey: Dispatch<SetStateAction<string | null>>;
  closeAll: () => void;
}

export interface EditorDraftContext {
  machine: TemplateDraftMachine;
  layout: NodePositionsApi;
  builderApi: RefObject<BuilderApi | null>;
  drawers: EditorDrawerState;
  draftSeq: MutableRefObject<number>;
}

export type { Draft, EditorNode };
