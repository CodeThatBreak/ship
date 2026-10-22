import { NextResponse } from "next/server";
import { gitLab } from "../../../../lib/integrations/gitlab";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = gitLab.listInstances().find((i) => i.id === id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();
  gitLab.updateInstance(id, {
    name: body.name ?? existing.name ?? undefined,
    base_url: body.base_url ?? existing.base_url,
    // blank token = keep existing
    token: body.token ? body.token : existing.token,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  gitLab.deleteInstance(id);
  return NextResponse.json({ ok: true });
}

/** Test connectivity/auth for this instance (uses stored token unless one is passed). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = gitLab.listInstances().find((i) => i.id === id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const result = await gitLab.testInstance(
    body.base_url ?? existing.base_url,
    body.token ? body.token : existing.token
  );
  return NextResponse.json(result);
}
