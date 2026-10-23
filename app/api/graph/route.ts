import { NextResponse } from "next/server";
import { nodeRegistry } from "../../../lib/engine/nodes/registry";
import { templateStore } from "../../../lib/engine/templates";
import { FlowRow, rows } from "../../../lib/db/rows";

export const dynamic = "force-dynamic";

/**
 * The workflow graph definition. Without `?flowId=` this is the built-in
 * graph derived from the node registry; with a flow id it reflects the flow's
 * own template snapshot (custom order / labels / edges, Phase 1: the seeded
 * SDLC loop, which resolves identically to the registry graph).
 */
export async function GET(req: Request) {
  const flowId = new URL(req.url).searchParams.get("flowId");
  if (flowId) {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (flow) {
      const g = templateStore.graphForFlow(flowId);
      if (g) {
        return NextResponse.json({
          templateId: g.templateId,
          order: g.nodes.map((n) => n.key),
          meta: Object.fromEntries(g.nodes.map((n) => [n.key, { label: n.label }])),
          edges: g.edges.map((e) => [e.from, e.to, e.kind] as const),
        });
      }
    }
  }
  return NextResponse.json({
    order: nodeRegistry.order(),
    meta: nodeRegistry.meta(),
    edges: nodeRegistry.edges(),
  });
}
