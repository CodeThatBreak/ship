import { NextResponse } from "next/server";
import { flowEngine } from "../../../lib/engine/flow-engine";
import { flowPoller } from "../../../lib/engine/runtime/flow-poller";

export const dynamic = "force-dynamic";

export async function GET() {
  flowPoller.start();
  return NextResponse.json({ flows: flowEngine.list() });
}

export async function POST(req: Request) {
  flowPoller.start();
  const { taskId, repoUrl, repoId, executionMode, name, templateId } = await req.json();
  if (!taskId || (!repoUrl && !repoId)) {
    return NextResponse.json({ error: "taskId and repoUrl (or repoId) required" }, { status: 400 });
  }
  try {
    const id = flowEngine.create(taskId, repoUrl ?? "", name, { executionMode, repoId, templateId });
    return NextResponse.json({ id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
