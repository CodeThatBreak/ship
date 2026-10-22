import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comments = db.all<any>(
    `SELECT * FROM comments WHERE flow_id=? ORDER BY created_at DESC`, id
  );
  return NextResponse.json({ comments });
}
