import { toErrorResponse } from "@/lib/errors";
import { artifactService } from "@/lib/artifacts/artifactService";
import { diffStaleness } from "@/lib/engine/facts/diffStaleness";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const art = await artifactService.get(id);
    // diff facts gain the read-only staleness read (Task 08): the live
    // branch head vs the capture's recorded headSha — every other kind
    // returns unchanged
    const described = await diffStaleness.describe(art);
    return NextResponse.json(described);
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};