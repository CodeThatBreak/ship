import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";

export const dynamic = "force-dynamic";

/** The artifacts row's read shape: everything spread through, plus the
 *  JSON-string `meta` column the route parses. */
type ArtifactRow = { meta?: string | null } & Record<string, unknown>;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const art = db.get<ArtifactRow>(`SELECT * FROM artifacts WHERE id=?`, id);
  if (!art) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...art, meta: art.meta ? JSON.parse(art.meta) : null });
}
