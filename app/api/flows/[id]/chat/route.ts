import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { flowEngine } from "../../../../../lib/engine/flow-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ messages: db.listMessages(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { nodeKey, content, chatOnly, model, thread } = await req.json();
  if (!nodeKey) return NextResponse.json({ error: "nodeKey required" }, { status: 400 });
  if (!content?.trim()) return NextResponse.json({ error: "content required" }, { status: 400 });
  try {
    flowEngine.sendChat(
      id,
      nodeKey,
      content.trim(),
      chatOnly === true,
      typeof model === "string" && model ? model : undefined,
      typeof thread === "string" && thread.trim() ? thread : undefined,
    );
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
