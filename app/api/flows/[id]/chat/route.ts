import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { flowEngine } from "../../../../../lib/engine/flow";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ messages: db.listMessages(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { nodeKey, content, chatOnly } = await req.json();
  if (!content?.trim()) return NextResponse.json({ error: "content required" }, { status: 400 });
  try {
    flowEngine.sendChat(id, nodeKey ?? "plan", content.trim(), chatOnly === true);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}
