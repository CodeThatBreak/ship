import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { validateNewGitHostBaseUrl } from "@/lib/integrations/instance-route-validation";
import { gitHostInstanceCreateBodySchema } from "@/lib/schemas/integration-instance";
import { NextResponse } from "next/server";
import { gitHostRegistry } from "../../../../lib/engine/ports/git-host";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Instances registered for one host kind (tokens masked). */
export const GET = async (_req: Request, { params }: { params: Promise<{ host: string }> }) => {
  const { host } = await params;
  const svc = gitHostRegistry.maybe(host);
  if (!svc) return NextResponse.json({ error: `unknown git host: ${host}` }, { status: 404 });
  return NextResponse.json({ instances: svc.instances(), configured: svc.configured() });
};

export const POST = async (req: Request, { params }: { params: Promise<{ host: string }> }) => {
  try {
    const { host } = await params;
    const svc = gitHostRegistry.maybe(host);
    if (!svc) return NextResponse.json({ error: `unknown git host: ${host}` }, { status: 404 });
    const body = await parseJson(req, gitHostInstanceCreateBodySchema);
    const baseUrl = await validateNewGitHostBaseUrl(body.baseUrl);
    const inst = svc.addInstance({ name: body.name, baseUrl, token: body.token });
    return NextResponse.json({ instance: inst });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
