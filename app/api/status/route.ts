import { NextResponse } from "next/server";
import { statusService } from "@/lib/status/statusService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async () => {
  return NextResponse.json(statusService.snapshot());
};
