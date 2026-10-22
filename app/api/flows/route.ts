import { NextResponse } from "next/server";
import { flowEngine } from "../../../lib/engine/flow";
import { flowPoller } from "../../../lib/engine/poller";

export const dynamic = "force-dynamic";

export async function GET() {
  flowPoller.start();
  return NextResponse.json({ flows: flowEngine.list() });
}

export async function POST(req: Request) {
  flowPoller.start();
  const { ticketId, repoUrl, repoId, executionMode, name } = await req.json();
  if (!ticketId || (!repoUrl && !repoId)) {
    return NextResponse.json({ error: "ticketId and repoUrl (or repoId) required" }, { status: 400 });
  }
  try {
    const id = flowEngine.create(ticketId, repoUrl ?? "", name, { executionMode, repoId });
    return NextResponse.json({ id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}
