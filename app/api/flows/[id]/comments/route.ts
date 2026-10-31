import { NextResponse } from "next/server";
import { commentService } from "@/lib/comments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json({ comments: commentService.listForFlow(id) });
};
