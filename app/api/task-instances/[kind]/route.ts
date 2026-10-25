import { NextResponse } from "next/server";
import { taskRegistry } from "../../../../lib/engine/tasks/registry";

export const dynamic = "force-dynamic";

/**
 * Instance registry of one task provider (Settings → Integrations → Task):
 * instances (tokens masked) + the provider's configured status.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const provider = taskRegistry.maybe(kind);
  if (!provider) return NextResponse.json({ error: `unknown task provider: ${kind}` }, { status: 404 });
  const store = provider.instanceStore();
  if (!store) return NextResponse.json({ error: `${provider.label} does not manage instances` }, { status: 400 });
  return NextResponse.json({ instances: store.instances(), configured: provider.configured() });
}

export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const provider = taskRegistry.maybe(kind);
  if (!provider) return NextResponse.json({ error: `unknown task provider: ${kind}` }, { status: 404 });
  const store = provider.instanceStore();
  if (!store) return NextResponse.json({ error: `${provider.label} does not manage instances` }, { status: 400 });
  const body = await req.json();
  const baseUrl = body.baseUrl ?? body.base_url;
  if (!baseUrl || !body.token) {
    return NextResponse.json({ error: "baseUrl and token are required" }, { status: 400 });
  }
  try {
    const inst = store.addInstance({ name: body.name ?? null, baseUrl, email: body.email, token: body.token });
    return NextResponse.json({ instance: inst });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
