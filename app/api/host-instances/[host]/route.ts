import { NextResponse } from "next/server";
import { gitHostRegistry } from "../../../../lib/engine/ports/git-host";

export const dynamic = "force-dynamic";

/** Instances registered for one host kind (tokens masked). */
export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const svc = gitHostRegistry.maybe(host);
  if (!svc) return NextResponse.json({ error: `unknown git host: ${host}` }, { status: 404 });
  return NextResponse.json({ instances: svc.instances(), configured: svc.configured() });
}

export async function POST(req: Request, { params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const svc = gitHostRegistry.maybe(host);
  if (!svc) return NextResponse.json({ error: `unknown git host: ${host}` }, { status: 404 });
  const body = await req.json();
  const baseUrl = body.baseUrl ?? body.base_url;
  if (!baseUrl || !body.token) {
    return NextResponse.json({ error: "baseUrl and token are required" }, { status: 400 });
  }
  const inst = svc.addInstance({ name: body.name ?? null, baseUrl, token: body.token });
  return NextResponse.json({ instance: inst });
}
