import { NextResponse } from "next/server";
import { nodeRegistry } from "../../../lib/engine/nodes/registry";
import { FlowRow, rows, type NodeTemplateRow } from "../../../lib/db/rows";
import { SDLC_TEMPLATE_ID, templateStore } from "../../../lib/engine/templates/template-store";
import { outputFieldsFor } from "../../../lib/engine/templates/template-lint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
        const catalogConfig = (nt?.config ?? {}) as Record<string, unknown>;
        return [n.key, {
          label: n.label,
          kind: nt?.kind ?? null,
          icon: nt?.icon ?? null,
          name: nt?.name ?? n.label,
          trigger: n.trigger,
          join_mode: n.joinMode,
          // the variables this node publishes downstream (the friendly
          // mapping universe for the next node's inputs)
          outputs: outputFieldsFor(nt?.kind ?? "builtin", { ...catalogConfig, ...(n.config ?? {}) }),
        }];
      })),
      edges: g.edges.map((e) => [e.from, e.to, e.kind] as const),
      // full edge specs (label/condition) for branch rendering in the graph
      edgeSpecs: g.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, label: e.label, condition: e.condition })),
    });
  }
  return NextResponse.json({
    order: nodeRegistry.order(),
    meta: nodeRegistry.meta(),
    edges: nodeRegistry.edges(),
  });
}
