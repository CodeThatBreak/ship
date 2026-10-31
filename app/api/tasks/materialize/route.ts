import { NextResponse } from "next/server";
import { taskRegistry } from "../../../../lib/engine/tasks/registry";
import type { LiveTask } from "../../../../lib/engine/tasks/taskProvider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Write a single live task into the `tasks` table — the write-through step
 * of "no Jira tasks in the DB": the table browses Jira live, and only when a
 * build starts is the picked task materialized (the flow engine needs the
 * row for the tasks FK + `{{task.*}}` context hydration). Idempotent on key.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const task = body?.task as LiveTask | undefined;
  if (
    !task ||
    typeof task.key !== "string" ||
    typeof task.id !== "string" ||
    typeof task.type !== "string"
  ) {
    return NextResponse.json(
      { error: "task payload with id, key and type required" },
      { status: 400 },
    );
  }
  const provider = taskRegistry.maybe(task.type);
  if (!provider) {
    return NextResponse.json(
      { error: `unknown task provider kind: ${task.type}` },
      { status: 404 },
    );
  }
  const id = provider.upsertLive(task);
  return NextResponse.json({ id, key: task.key });
}
