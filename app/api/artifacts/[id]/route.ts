import { toErrorResponse } from "@/lib/errors";
import { artifactService } from "@/lib/artifacts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const art = artifactService.get(id);
    return NextResponse.json(art);
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
