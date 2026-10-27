import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { reconciler } from "../../../../../lib/engine/runtime/flow-reconciler";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // throttled internally — keeps stuck `running` nodes converging while the
  // page is open, even if the flow was never re-opened after a restart
  void reconciler.reconcileFlow(id).catch(() => {});
  const url = new URL(req.url);
  const after = url.searchParams.get("after") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 200);
  const events = db.all<Record<string, unknown>>(
    `SELECT * FROM events WHERE flow_id=? AND id > ? ORDER BY created_at, id LIMIT ?`,
    id, after, limit
  );
  return NextResponse.json({ events });
}
