import { NextResponse } from "next/server";
import { templatePreviewService } from "@/lib/engine/templates/templatePreviewService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!templatePreviewService.assertTemplateExists(id)) {
    return NextResponse.json({ error: "template not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as null | {
    expr?: unknown;
    scope?: unknown;
  };
  const expr = typeof body?.expr === "string" ? body.expr : "";
  const scope =
    body?.scope === "response" || body?.scope === "delivery" ? body.scope : "context";
  const result = await templatePreviewService.evaluate(id, { expr, scope });
  return NextResponse.json(result);
};
