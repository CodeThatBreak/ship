import { NextResponse } from "next/server";
import { templateStore } from "../../../../../lib/engine/templates/templateStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!templateStore.flowTemplate(id)) {
    return NextResponse.json({ error: "template not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const problems = templateStore.lintDraft(
    body as Parameters<typeof templateStore.lintDraft>[0],
  );
  return NextResponse.json({ problems });
};
