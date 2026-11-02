import { NextResponse } from "next/server";
import { processSingleton } from "@/lib/singleton";
import { WorktreeStatusService } from "@/lib/engine/runtime/worktreeStatusService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const worktreeStatusService = processSingleton(
  "worktreeStatusService",
  () => new WorktreeStatusService(),
);

export const GET = async () => {
  const statuses = await worktreeStatusService.statusesForActiveFlows();
  return NextResponse.json({ statuses });
};
