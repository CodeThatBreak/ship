import { NextResponse } from "next/server";
import { gitHostRegistry } from "../../../../../lib/engine/ports/git-host";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ host: string; id: string }> }) {
  const { host, id } = await params;
  const svc = gitHostRegistry.maybe(host);
  if (!svc) return NextResponse.json({ error: `unknown git host: ${host}` }, { status: 404 });
  const body = await req.json();
  svc.updateInstance(id, {
    name: body.name,
    baseUrl: body.baseUrl ?? body.base_url,
    // blank token = keep the stored one (adapter-side)
    token: body.token,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ host: string; id: string }> }) {
  const { host, id } = await params;
  const svc = gitHostRegistry.maybe(host);
  if (!svc) return NextResponse.json({ error: `unknown git host: ${host}` }, { status: 404 });
  svc.removeInstance(id);
  return NextResponse.json({ ok: true });
}

/** Test connectivity/auth for this instance (uses stored token unless one is passed). */
export async function POST(req: Request, { params }: { params: Promise<{ host: string; id: string }> }) {
  const { host, id } = await params;
  const svc = gitHostRegistry.maybe(host);
  if (!svc) return NextResponse.json({ error: `unknown git host: ${host}` }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const result = await svc.testInstance(id, { baseUrl: body.baseUrl ?? body.base_url, token: body.token });
  return NextResponse.json(result);
}
