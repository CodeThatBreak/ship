import { toErrorResponse } from "@/lib/errors";
import { parseQuery } from "@/lib/http/parse";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../../../../../lib/db";
import { reconciler } from "../../../../../lib/engine/runtime/flow-reconciler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EventsQuery = z.object({
  after: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    void reconciler.reconcileFlow(id).catch(() => {});
    const url = new URL(req.url);
    const { after, limit } = parseQuery(url, EventsQuery);
    const events = db.listEvents(id, after, limit);
    return NextResponse.json({ events });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
