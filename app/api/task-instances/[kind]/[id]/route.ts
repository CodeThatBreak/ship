import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import {
  taskInstancePatchBodySchema,
  taskInstanceTestBodySchema,
} from "@/lib/schemas/integration-instance";
import { NextResponse } from "next/server";
import { taskRegistry } from "../../../../../lib/engine/tasks/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = async (req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) => {
  const { kind, id } = await params;
  const provider = taskRegistry.maybe(kind);
  const store = provider?.instanceStore();
  if (!provider || !store) return NextResponse.json({ error: `unknown task provider: ${kind}` }, { status: 404 });
  try {
    const body = await parseJson(req, taskInstancePatchBodySchema);
    store.updateInstance(id, {
      name: body.name,
      baseUrl: body.baseUrl ?? body.base_url,
      email: body.email,
      token: body.token,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
};

export const DELETE = async (_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) => {
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
};

/** Test connectivity/auth for this instance (uses stored token unless one is passed). */
export const POST = async (req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) => {
  const { kind, id } = await params;
  const provider = taskRegistry.maybe(kind);
  const store = provider?.instanceStore();
  if (!provider || !store) return NextResponse.json({ error: `unknown task provider: ${kind}` }, { status: 404 });
  try {
    const body = await parseJson(req, taskInstanceTestBodySchema);
    const result = await store.testInstance(id, {
      baseUrl: body.baseUrl ?? body.base_url,
      email: body.email,
      token: body.token,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
};
