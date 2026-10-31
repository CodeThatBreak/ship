import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { repoService } from "@/lib/repos";
import { repoCreateBodySchema } from "@/lib/schemas/repo";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async () => {
  return NextResponse.json({ repos: repoService.listWithPathStatus() });
};

export const POST = async (req: Request) => {
  try {
    const body = await parseJson(req, repoCreateBodySchema);
    const repo = repoService.create(body);
    return NextResponse.json({ repo });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
