import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../../../../../lib/db";
import { flowEngine } from "../../../../../lib/engine/flow-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ChatBody = z.object({
  nodeKey: z.string().min(1),
  content: z.string().trim().min(1),
  chatOnly: z.boolean().optional(),
  model: z.string().min(1).optional(),
  thread: z.string().trim().min(1).optional(),
});

export const GET = async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json({ messages: db.listMessages(id) });
};

export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const body = await parseJson(req, ChatBody);
    flowEngine.sendChat(
      id,
      body.nodeKey,
      body.content,
      body.chatOnly === true,
      body.model,
      body.thread,
    );
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
