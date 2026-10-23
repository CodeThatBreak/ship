import { NextResponse } from "next/server";
import { templateStore, type TemplateInput, type TemplateNodeInput, type TemplateEdgeInput } from "../../../../lib/engine/templates";

export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ error: "template not found" }, { status: 404 });
}

/** The full editor payload: template meta + node instances + edges. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = templateStore.flowTemplate(id);
  if (!t) return notFound();
  const g = templateStore.graph(id);
  if (!g) return notFound();
  return NextResponse.json({
    template: {
      id: t.id,
      name: t.name,
      description: t.description,
      version: t.version,
      is_builtin: t.is_builtin,
      trigger: g.flowTrigger,
    },
    nodes: g.nodes.map((n) => {
      const nt = templateStore.nodeTemplate(n.nodeTemplateId);
      return {
        key: n.key,
        node_template_id: n.nodeTemplateId,
        label: n.label,
        trigger: n.trigger,
        join_mode: n.joinMode,
        config: n.config,
        input_map: n.inputMap,
        kind: nt?.kind ?? null,
        icon: nt?.icon ?? null,
        catalog_name: nt?.name ?? null,
        is_builtin: Boolean(nt?.is_builtin),
      };
    }),
    edges: g.edges,
  });
}

/** Meta patch; node/edge arrays replace the whole graph (the editor draft). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as
    | null
    | (Partial<TemplateInput> & { nodes?: TemplateNodeInput[]; edges?: TemplateEdgeInput[] });
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    templateStore.update(id, body);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    templateStore.delete(id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
