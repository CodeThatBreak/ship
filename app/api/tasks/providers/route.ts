import { NextResponse } from "next/server";
import { taskRegistry } from "../../../../lib/engine/tasks/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async () => {
  return NextResponse.json({ providers: taskRegistry.describe() });
};
