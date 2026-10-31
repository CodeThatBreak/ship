import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { nodeTemplatePatchBodySchema } from "@/lib/schemas/node-template";
import { NextResponse } from "next/server";
import { templateStore } from "../../../../lib/engine/templates/template-store";
import { invalidateDeclarativeDef } from "../../../../lib/engine/nodes/declarative";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Update a declarative node template, or promote a template-local row to the global Library. */
export const PATCH = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const body = await parseJson(req, nodeTemplatePatchBodySchema);
    if (body.add_to_library === true) {
      const nt = templateStore.addToLibrary(id);
      invalidateDeclarativeDef(id);
      return NextResponse.json({ nodeTemplate: templateStore.toNodeCatalogRow(nt) });
    }
    const nt = templateStore.updateNodeTemplate(id, body);
    invalidateDeclarativeDef(id);
    return NextResponse.json({ nodeTemplate: templateStore.toNodeCatalogRow(nt) });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};

export const DELETE = async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    templateStore.deleteNodeTemplate(id);
    invalidateDeclarativeDef(id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
