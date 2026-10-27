"use client";
/**
 * The visual flow builder canvas (Phase 5A): a drag-drop editor over the
 * template graph, built on @xyflow/react. Layout: persisted x/y positions win
 * (the page seeds dagre auto-layout positions for nodes without saved ones).
 * Clicking a node opens its configurator drawer; clicking an edge opens the
 * edge drawer. Structural edits (add/connect/delete) mutate the page's draft,
 * which PATCHes wholesale on save; position drags sync x/y immediately via the
 * positions-only PATCH. Backspace/Delete remove the selected node/edge
 * (deletability-aware — the Start node and read-only templates are exempt).
 *
 * This container is the public surface: it provides the RF context and hosts
 * the flow body (see `components/builder-flow.tsx`, and the node/edge
 * renderers in `components/builder-*`).
 */
import { ReactFlowProvider } from "@xyflow/react";
import { BuilderFlow } from "./components/BuilderFlow";
import type { BuilderNodeData } from "./components/BuilderNodeView";
import type { BuilderEdgeData } from "./components/BuilderEdgeView";
import type { BuilderCanvasProps, BuilderApi } from "./components/BuilderFlow";

export type { BuilderCanvasProps, BuilderApi };
export type { BuilderNodeData };
export type { BuilderEdgeData };

export default function BuilderCanvas(props: BuilderCanvasProps) {
  return (
    <ReactFlowProvider>
      <BuilderFlow {...props} />
    </ReactFlowProvider>
  );
}
