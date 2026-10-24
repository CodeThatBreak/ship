import { listTasks, syncTasks } from "../tasks/handlers";

/**
 * DEPRECATED: moved to /api/tasks. Kept as a thin shim for external scripts
 * (curl one-liners, cron syncs) — dropped in the Phase 4 cleanup.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return withDeprecation(listTasks());
}

/** Sync tasks from Jira into the local DB. */
export async function POST() {
  return withDeprecation(await syncTasks());
}

function withDeprecation(res: Response): Response {
  res.headers.set("Deprecation", "true");
  res.headers.set(
    "Warning",
    `299 - "endpoint moved to /api/tasks — /api/tickets will be dropped"`
  );
  return res;
}
