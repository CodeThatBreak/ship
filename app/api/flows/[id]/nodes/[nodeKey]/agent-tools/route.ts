import { NextResponse } from "next/server";
import { toErrorResponse, UnauthorizedError } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { agentToolCallSchema } from "@/lib/engine/agentTools/schemas/agentToolCalls";
import { engineParts } from "@/lib/composition/container";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The agent-tools endpoint (step 08, Invariant 10): the running agent's
 * self-repair surface. Thin handler — parse the discriminated-union body,
 * read the `Authorization: Bearer` capability token, hand both to the
 * `AgentToolService` (auth → capability → dispatch). Authenticated by the
 * per-attempt token, NOT the local-API token (the middleware stands down on
 * this path — `isSelfAuthenticatedApiPath`); no business logic here.
 */

const bearerTokenOf = (req: Request): string =>
  req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";

export const POST = async (
  req: Request,
  { params }: { params: Promise<{ id: string; nodeKey: string }> },
) => {
  try {
    const { id, nodeKey } = await params;
    const token = bearerTokenOf(req);
    if (!token) throw new UnauthorizedError("missing agent tool token");
    const call = await parseJson(req, agentToolCallSchema);
    const result = await engineParts.agentTools.dispatch({ flowId: id, nodeKey, token, call });
    return NextResponse.json({ ok: true, result });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
