import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import {
  validateGitHostInstanceBaseUrl,
  resolveInstanceTestBaseUrl,
} from "@/lib/integrations/instanceRouteValidation";
import {
  gitHostInstancePatchBodySchema,
  gitHostInstanceTestBodySchema,
} from "@/lib/schemas/integrationInstance";
import { NextResponse } from "next/server";
import { gitHostRegistry } from "../../../../../lib/engine/ports/gitHost";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = async (req: Request, { params }: { params: Promise<{ host: string; id: string }> }) => {
  try {
    const { host, id } = await params;
    const svc = gitHostRegistry.maybe(host);
    if (!svc) return NextResponse.json({ error: `unknown git host: ${host}` }, { status: 404 });
    const body = await parseJson(req, gitHostInstancePatchBodySchema);
    const nextBase = body.baseUrl ?? body.base_url;
    if (nextBase) {
      await validateGitHostInstanceBaseUrl(svc, id, nextBase);
    }
    svc.updateInstance(id, {
      name: body.name,
      baseUrl: body.baseUrl ?? body.base_url,
      token: body.token,
    });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};

export const DELETE = async (_req: Request, { params }: { params: Promise<{ host: string; id: string }> }) => {
  try {
    const { host, id } = await params;
    const svc = gitHostRegistry.maybe(host);
    if (!svc) return NextResponse.json({ error: `unknown git host: ${host}` }, { status: 404 });
    svc.removeInstance(id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};

/** Test connectivity/auth for this instance (uses stored token unless one is passed). */
export const POST = async (req: Request, { params }: { params: Promise<{ host: string; id: string }> }) => {
  try {
    const { host, id } = await params;
    const svc = gitHostRegistry.maybe(host);
    if (!svc) return NextResponse.json({ error: `unknown git host: ${host}` }, { status: 404 });
    const body = await parseJson(req, gitHostInstanceTestBodySchema);
    const existing = svc.instances().find((i) => i.id === id);
    if (!existing) return NextResponse.json({ error: `host instance not found: ${id}` }, { status: 404 });
    const baseUrl = await resolveInstanceTestBaseUrl(existing.baseUrl, body.baseUrl ?? body.base_url);
    const result = await svc.testInstance(id, { baseUrl, token: body.token });
    return NextResponse.json(result);
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
