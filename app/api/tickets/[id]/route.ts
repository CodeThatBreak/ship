import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";

export const dynamic = "force-dynamic";

/** Update ticket fields we manage locally (e.g. repo mapping). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (body.repoUrl !== undefined) {
    db.run(`UPDATE tickets SET repo_url=? WHERE id=?`, body.repoUrl, id);
  }
  return NextResponse.json({ ok: true, updated_at: db.now() });
}
