import { NextResponse } from "next/server";
import { liveTaskFeed } from "@/lib/engine/tasks/liveTaskFeed";
import type { LiveTaskFilters } from "@/lib/engine/tasks/taskProvider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async (req: Request) => {
  const url = new URL(req.url);
  const filters: LiveTaskFilters = {
    assignee: url.searchParams.get("assignee") === "any" ? "any" : "me",
    statusCategory: (url.searchParams.get("statusCategory") ?? "").slice(0, 40) || undefined,
    text: (url.searchParams.get("text") ?? "").slice(0, 200) || undefined,
  };
  const fresh = url.searchParams.get("fresh") === "1";
  const kind = url.searchParams.get("kind") ?? undefined;

  const result = await liveTaskFeed.fetch(kind, filters, { fresh });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    tasks: result.tasks,
    ...result.meta,
  });
};
