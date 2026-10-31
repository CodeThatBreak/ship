import { toErrorResponse } from "@/lib/errors";
import { NextResponse } from "next/server";
import { taskRegistry } from "../../../../../lib/engine/tasks/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const provider = taskRegistry.maybe(kind);
  const store = provider?.instanceStore();
  if (!provider || !store) return NextResponse.json({ error: `unknown task provider: ${kind}` }, { status: 404 });
  const body = await req.json();
  try {
    store.updateInstance(id, {
      name: body.name,
      baseUrl: body.baseUrl ?? body.base_url,
      email: body.email,
      // blank token = keep the stored one (adapter-side)
      token: body.token,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const provider = taskRegistry.maybe(kind);
  const store = provider?.instanceStore();
  if (!provider || !store) return NextResponse.json({ error: `unknown task provider: ${kind}` }, { status: 404 });
  try {
    store.removeInstance(id);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
}

/** Test connectivity/auth for this instance (uses stored token unless one is passed). */
export async function POST(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const provider = taskRegistry.maybe(kind);
  const store = provider?.instanceStore();
  if (!provider || !store) return NextResponse.json({ error: `unknown task provider: ${kind}` }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const result = await store.testInstance(id, {
      baseUrl: body.baseUrl ?? body.base_url,
      email: body.email,
      token: body.token,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
}
