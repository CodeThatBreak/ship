import { NextResponse } from "next/server";
import { nodeRegistry } from "../../../lib/engine/nodes/registry";
import { FlowRow, rows, type NodeTemplateRow } from "../../../lib/db/rows";
import { SDLC_TEMPLATE_ID, templateStore } from "../../../lib/engine/templates";

export const dynamic = "force-dynamic";

/**
 * The workflow graph definition. Without `?flowId=` this is the built-in
 * graph derived from the node registry; with a flow id (or ?templateId=, for
 * the editor preview) it reflects that template (custom order / labels /
 * edges). Meta carries `label`, `kind` and `icon` (the node_templates icon
 * column) so the graph renders declarative nodes correctly.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const flowId = url.searchParams.get("flowId");
  const templateId = url.searchParams.get("templateId");
  let g = null;
  if (flowId || templateId) {
    const tid =
      templateId ?? rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId ?? "")?.template_id ?? null;
    g = templateStore.graph(tid ?? SDLC_TEMPLATE_ID);
  }
  if (g) {
    const nts = new Map(templateStore.listNodeTemplates().map((nt) => [nt.id, nt]));
    return NextResponse.json({
      templateId: g.templateId,
      order: g.nodes.map((n) => n.key),
      meta: Object.fromEntries(g.nodes.map((n) => {
        const nt = nts.get(n.nodeTemplateId) as NodeTemplateRow | undefined;
        return [n.key, {
          label: n.label,
          kind: nt?.kind ?? null,
          icon: nt?.icon ?? null,
          name: nt?.name ?? n.label,
          trigger: n.trigger,
          join_mode: n.joinMode,
        }];
      })),
      edges: g.edges.map((e) => [e.from, e.to, e.kind] as const),
    });
  }
  return NextResponse.json({
    order: nodeRegistry.order(),
    meta: nodeRegistry.meta(),
    edges: nodeRegistry.edges(),
  });
}
