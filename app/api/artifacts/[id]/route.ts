import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const art = db.get<any>(`SELECT * FROM artifacts WHERE id=?`, id);
  if (!art) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...art, meta: art.meta ? JSON.parse(art.meta) : null });
}
