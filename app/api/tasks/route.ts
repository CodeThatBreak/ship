import { NextResponse } from "next/server";
import { taskService } from "@/lib/engine/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async () => {
  return NextResponse.json(taskService.list());
};
