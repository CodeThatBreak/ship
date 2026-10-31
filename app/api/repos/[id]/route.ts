import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { repoService } from "@/lib/repos";
import { repoPatchBodySchema } from "@/lib/schemas/repo";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const body = await parseJson(req, repoPatchBodySchema);
    const repo = repoService.update(id, body);
    return NextResponse.json({ repo });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};

export const DELETE = async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    repoService.delete(id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
