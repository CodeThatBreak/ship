import { NextResponse } from "next/server";
import { WorktreeStatusService } from "@/lib/engine/runtime/worktreeStatusService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Shared worktree-status service (stateless, db-fenced — decision Q9, plain module const). */
const worktreeStatusService = new WorktreeStatusService();

export const GET = async () => {
  const statuses = await worktreeStatusService.statusesForActiveFlows();
  return NextResponse.json({ statuses });
};
