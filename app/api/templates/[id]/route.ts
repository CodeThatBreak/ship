import { toErrorResponse } from "@/lib/errors";
import { NextResponse } from "next/server";
import {
  templateStore,
  type DraftNodeTemplateInput,
  type TemplateEdgeInput,
  type TemplateInput,
  type TemplateNodeInput,
} from "../../../../lib/engine/templates/template-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const notFound = () => NextResponse.json({ error: "template not found" }, { status: 404 });

/** The full editor payload: template meta + node instances + edges. */
export const GET = async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  // the single mapping source is TemplateStore.editorPayload (the SSR boot
  // hydrates the same shape — loaders/templates)
  const payload = templateStore.editorPayload(id);
  if (!payload) return notFound();
  return NextResponse.json(payload);
};

/** Meta patch; node/edge arrays replace the whole graph (the editor draft). */
export const PATCH = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json().catch(() => null) as
    | null
    | (Partial<TemplateInput> & {
        nodes?: TemplateNodeInput[];
        edges?: TemplateEdgeInput[];
        positions?: Record<string, { x: number; y: number }>;
        new_node_templates?: DraftNodeTemplateInput[];
      });
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    // positions-only drag sync (Phase 5): display metadata, no graph rewrite
    if (body.positions && body.nodes === undefined && body.edges === undefined) {
      templateStore.updatePositions(id, body.positions);
      return NextResponse.json({ ok: true });
    }
    templateStore.saveWithDrafts(id, body);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};

export const DELETE = async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  try {
    templateStore.delete(id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
