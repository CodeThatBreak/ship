import { toErrorResponse } from "@/lib/errors";
import { parseQuery } from "@/lib/http/parse";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../../../../../lib/db/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EventsQuery = z.object({
  after: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  tail: z.coerce.number().int().min(1).max(500).optional(),
});

export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const { after, limit, tail } = parseQuery(url, EventsQuery);
    const events =
      tail !== undefined ? db.listEventsTail(id, tail) : db.listEvents(id, after, limit);
    return NextResponse.json({ events });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
