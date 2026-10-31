import { toErrorResponse } from "@/lib/errors";
import { graphService } from "@/lib/engine/graph";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const payload = graphService.resolve({
      flowId: url.searchParams.get("flowId"),
      templateId: url.searchParams.get("templateId"),
    });
    return NextResponse.json(payload);
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
