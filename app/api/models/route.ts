import { NextResponse } from "next/server";
import { modelCatalogService } from "@/lib/model-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async () => {
  return NextResponse.json(await modelCatalogService.normalized());
};
