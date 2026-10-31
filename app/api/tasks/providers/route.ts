import { NextResponse } from "next/server";
import { taskRegistry } from "../../../../lib/engine/tasks/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Registered task providers — the import screen's cards and the homepage's
 * task-type filter chips read this. Registering a provider (one file + one
 * `taskRegistry.register(...)` line) is all it takes to appear here.
 */
export async function GET() {
  return NextResponse.json({
    providers: taskRegistry.list().map((p) => ({
      kind: p.kind,
      label: p.label,
      configured: p.configured(),
      contextFields: p.contextFields,
    })),
  });
}
