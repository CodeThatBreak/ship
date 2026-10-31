import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { taskInstanceCreateBodySchema } from "@/lib/schemas/integration-instance";
import { NextResponse } from "next/server";
import { taskRegistry } from "../../../../lib/engine/tasks/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Instance registry of one task provider (Settings → Integrations → Task):
 * instances (tokens masked) + the provider's configured status.
 */
export const GET = async (_req: Request, { params }: { params: Promise<{ kind: string }> }) => {
  const { kind } = await params;
  const provider = taskRegistry.maybe(kind);
  if (!provider) return NextResponse.json({ error: `unknown task provider: ${kind}` }, { status: 404 });
  const store = provider.instanceStore();
  if (!store) return NextResponse.json({ error: `${provider.label} does not manage instances` }, { status: 400 });
  return NextResponse.json({ instances: store.instances(), configured: provider.configured() });
};

export const POST = async (req: Request, { params }: { params: Promise<{ kind: string }> }) => {
  try {
    const { kind } = await params;
    const provider = taskRegistry.maybe(kind);
    if (!provider) return NextResponse.json({ error: `unknown task provider: ${kind}` }, { status: 404 });
    const store = provider.instanceStore();
    if (!store) return NextResponse.json({ error: `${provider.label} does not manage instances` }, { status: 400 });
    const body = await parseJson(req, taskInstanceCreateBodySchema);
    const inst = store.addInstance(body);
    return NextResponse.json({ instance: inst });
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
};
